import * as THREE from "three";
import {
  cameraRay,
  projectPoint,
  triangulateColumn,
  type Pinhole,
  type Vec3,
} from "./geometry";
import {
  createSeededRandom,
  decodeNStep,
  TAU,
  type PhaseResult,
} from "../core/simulation";
import {
  buildTraceScene,
  evaluateBrdf,
  sampleBrdf,
  type SurfaceMaterial,
} from "./lightTransport";
import { buildPcbGeometry, PCB_BOARD_TOP } from "./pcb";
import { buildBoardScene } from "./boardScenes";
import {
  cameraPinhole,
  devicePosition,
  PAIR_CLASSES,
  projectorPinhole,
  type Device,
  type PairClass,
} from "./devices";
import { blurDiameter, blurSigma, gaussianMtf, scatterBlur } from "./optics";

/** All lengths are millimetres. The earlier sandbox used 1 unit = 25 mm (see migrateLegacyConfig). */
export const LEGACY_UNIT_MM = 25;

export const WORLD_SHAPES = [
  "sphere",
  "box",
  "ramp",
  "vgroove",
  "pcb",
  "step",
  "chip",
  "plane",
] as const;
export type WorldShape = (typeof WORLD_SHAPES)[number];
/** Shapes whose object position is the top of a flat board (the AOI reference plane). */
export const BOARD_SHAPES: readonly WorldShape[] = ["step", "chip", "plane"];
export const CODINGS = ["temporal", "single", "dual", "coarse"] as const;
export type CodingMode = (typeof CODINGS)[number];

export interface ClassReference {
  /** Height per fringe period (2π) from the AOI vendor or the real machine, mm. */
  heightPer2Pi: number | null;
  /** Measurement range from the AOI vendor or the real machine, mm. */
  range: number | null;
  /** |dφ/dh| relative to the direct-view pairs. */
  sensitivityRatio: number | null;
  /** Height noise relative to the direct-view pairs. */
  noiseRatio: number | null;
  note: string;
}

export interface WorldConfig {
  shape: WorldShape;
  /** Object position, mm. For PCB it is the board centre; for board scenes the board top. */
  x: number;
  y: number;
  z: number;
  /** Full opening angle of the V-groove in degrees. */
  grooveAngle: number;
  /** Aim point offset from the object position in the board plane, mm. */
  aimX: number;
  aimZ: number;
  /** World height of the calibrated reference plane (AOI height zero), mm. */
  referenceHeight: number;
  cameras: Device[];
  projectors: Device[];
  /** The pair scanned by the 3D sandbox. */
  activeCamera: string;
  activeProjector: string;
  /** Camera image width in pixels; height is always 3/4 of it. */
  cameraWidth: number;
  projectorWidth: number;
  /** n×n sub-rays averaged per pixel (1 = point sampling, no mixed pixels). */
  pixelGrid: number;
  /** Fringe periods across the projector width for the fine pattern. */
  fringeFrequency: number;
  /** Phase-shift steps N; shifts are 2πk/N. */
  phaseSteps: number;
  /** Projected pattern = offset + amplitude·cos(…), both in projector gray level. */
  fringeOffset: number;
  fringeAmplitude: number;
  /** temporal: +N unit-frequency frames; single: reference-plane window; dual: +N frames at f/periodRatio. */
  coding: CodingMode;
  periodRatio: number;
  /** Bottom of the phase window above the reference plane, mm. */
  windowBottom: number;
  minModulation: number;
  exposure: number;
  seed: number;
  noiseSigma: number;
  defocus: boolean;
  /** Every device focuses on this height above the reference plane at the aim point, mm. */
  focusHeight: number;
  objectAlbedo: number;
  objectSpecular: number;
  objectRoughness: number;
  groundAlbedo: number;
  groundSpecular: number;
  groundRoughness: number;
  chipAlbedo: number;
  chipSpecular: number;
  chipRoughness: number;
  pinAlbedo: number;
  pinSpecular: number;
  pinRoughness: number;
  solderAlbedo: number;
  solderSpecular: number;
  solderRoughness: number;
  interreflection: boolean;
  bounces: number;
  giSamples: number;
  /** Multi-view analysis: camera tilt at or below this counts as 直視. */
  directTiltLimit: number;
  roiWidth: number;
  roiHeight: number;
  cellSize: number;
  /** |height error| at or below this counts as accurate, mm (evaluation only). */
  tolerance: number;
  /** Cross-pair agreement gate used by fusion, mm. */
  consistencyTolerance: number;
  /** Height range the AOI must cover, used for the period recommendation, mm. */
  targetRange: number;
  references: Record<PairClass, ClassReference>;
}

const emptyReference = (): ClassReference => ({
  heightPer2Pi: null,
  range: null,
  sensitivityRatio: null,
  noiseRatio: null,
  note: "",
});
export const emptyReferences = (): Record<PairClass, ClassReference> => ({
  direct: emptyReference(),
  opposite: emptyReference(),
  orthogonal: emptyReference(),
  same: emptyReference(),
});

export const DEFAULT_WORLD: WorldConfig = {
  shape: "sphere",
  x: 0,
  y: 18.75,
  z: 0,
  grooveAngle: 90,
  aimX: 0,
  aimZ: 0,
  referenceHeight: 0,
  cameras: [
    { id: "C0", name: "Camera", x: 0, y: 87.5, z: 0, fov: 45, aperture: 0 },
  ],
  projectors: [
    {
      id: "P0",
      name: "Projector",
      x: 62.5,
      y: 18.75,
      z: 0,
      fov: 55,
      aperture: 0,
    },
  ],
  activeCamera: "C0",
  activeProjector: "P0",
  cameraWidth: 96,
  projectorWidth: 640,
  pixelGrid: 1,
  fringeFrequency: 1,
  phaseSteps: 3,
  fringeOffset: 0.4,
  fringeAmplitude: 0.36,
  coding: "temporal",
  periodRatio: 1.25,
  windowBottom: -0.2,
  minModulation: 0.01,
  exposure: 1,
  seed: 42,
  noiseSigma: 0,
  defocus: true,
  focusHeight: 0,
  objectAlbedo: 0.8,
  objectSpecular: 0,
  objectRoughness: 0.3,
  groundAlbedo: 0.5,
  groundSpecular: 0,
  groundRoughness: 0.6,
  chipAlbedo: 0.06,
  chipSpecular: 0.04,
  chipRoughness: 0.5,
  pinAlbedo: 0,
  pinSpecular: 0.8,
  pinRoughness: 0.35,
  solderAlbedo: 0.1,
  solderSpecular: 0.7,
  solderRoughness: 0.3,
  interreflection: false,
  bounces: 1,
  giSamples: 32,
  directTiltLimit: 10,
  roiWidth: 8,
  roiHeight: 6,
  cellSize: 0.12,
  tolerance: 0.05,
  consistencyTolerance: 0.08,
  targetRange: 2,
  references: emptyReferences(),
};

/** Inspection setup applied when choosing the PCB: board material, overhead rig, finer camera. */
export const PCB_SETUP: Partial<WorldConfig> = {
  shape: "pcb",
  x: 0,
  y: 16.25,
  z: 0,
  aimX: 0,
  aimZ: 0,
  referenceHeight: 16.25 + PCB_BOARD_TOP * LEGACY_UNIT_MM,
  cameras: [
    { id: "C0", name: "Camera", x: 0, y: 65, z: 0, fov: 45, aperture: 0 },
  ],
  projectors: [
    { id: "P0", name: "Projector", x: 30, y: 57.5, z: 0, fov: 55, aperture: 0 },
  ],
  activeCamera: "C0",
  activeProjector: "P0",
  cameraWidth: 256,
  pixelGrid: 2,
  objectAlbedo: 0.25,
  objectSpecular: 0.06,
  objectRoughness: 0.3,
};

/** PCB regions of interest (aim offsets from the board centre, mm). */
export const PCB_REGIONS = [
  ["center", "板中心", 0, 0],
  ["passives", "R1 / C1 / C2 被動元件", -8.125, 9.375],
  ["qfp", "U1 QFP 引腳列", -8.75, -2],
  ["soic", "U2 SOIC", 8.75, -7.5],
  ["header", "J1 排針（4 mm 高）", 8.75, 6.25],
] as const;

/** Devices look at this point; the multi-view grid is centred on it. */
export const rigTarget = (config: WorldConfig): Vec3 => [
  config.x + config.aimX,
  config.y,
  config.z + config.aimZ,
];
/** Point every lens is focused on: the aim vertical at referenceHeight + focusHeight. */
export const focusPoint = (config: WorldConfig): Vec3 => [
  config.x + config.aimX,
  config.referenceHeight + config.focusHeight,
  config.z + config.aimZ,
];
export const RIG_MIN_DISTANCE = 12.5;

export const WORLD_LIMITS = {
  x: [-50, 50],
  y: [0, 62.5],
  z: [-50, 50],
  grooveAngle: [30, 150],
  aimX: [-30, 30],
  aimZ: [-30, 30],
  referenceHeight: [-10, 60],
  cameraWidth: [64, 384],
  projectorWidth: [160, 1920],
  pixelGrid: [1, 3],
  fringeFrequency: [1, 128],
  phaseSteps: [3, 12],
  fringeOffset: [0.05, 0.95],
  fringeAmplitude: [0.01, 0.5],
  periodRatio: [1.02, 64],
  windowBottom: [-20, 20],
  minModulation: [0, 0.2],
  exposure: [0.1, 8],
  seed: [0, 4294967295],
  noiseSigma: [0, 0.05],
  focusHeight: [-20, 60],
  objectAlbedo: [0, 1],
  objectSpecular: [0, 1],
  objectRoughness: [0.05, 1],
  groundAlbedo: [0, 1],
  groundSpecular: [0, 1],
  groundRoughness: [0.05, 1],
  chipAlbedo: [0, 1],
  chipSpecular: [0, 1],
  chipRoughness: [0.05, 1],
  pinAlbedo: [0, 1],
  pinSpecular: [0, 1],
  pinRoughness: [0.05, 1],
  solderAlbedo: [0, 1],
  solderSpecular: [0, 1],
  solderRoughness: [0.05, 1],
  bounces: [1, 3],
  giSamples: [8, 256],
  directTiltLimit: [0, 30],
  roiWidth: [1, 100],
  roiHeight: [1, 100],
  cellSize: [0.02, 5],
  tolerance: [0.001, 10],
  consistencyTolerance: [0.001, 10],
  targetRange: [0.05, 50],
} as const satisfies Partial<
  Record<keyof WorldConfig, readonly [number, number]>
>;
export type NumericKey = keyof typeof WORLD_LIMITS;
export const DEVICE_LIMITS = {
  x: [-300, 300],
  y: [1, 400],
  z: [-300, 300],
  fov: [1, 80],
  aperture: [0, 50],
} as const;
export const MAX_DEVICES = 8;
export const BOOLEAN_KEYS = ["interreflection", "defocus"] as const;
const INTEGER_KEYS = new Set([
  "seed",
  "bounces",
  "giSamples",
  "cameraWidth",
  "projectorWidth",
  "pixelGrid",
  "phaseSteps",
]);
export const cameraHeight = (config: WorldConfig) =>
  (config.cameraWidth * 3) / 4;

const inRange = (value: unknown, [lo, hi]: readonly [number, number]) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= lo &&
  value <= hi;

export function validateWorldConfig(config: WorldConfig): void {
  if (!(WORLD_SHAPES as readonly string[]).includes(config.shape))
    throw new RangeError("Unknown world shape");
  if (!(CODINGS as readonly string[]).includes(config.coding))
    throw new RangeError("Unknown fringe coding");
  for (const key of BOOLEAN_KEYS)
    if (typeof config[key] !== "boolean")
      throw new RangeError(`${key} must be a boolean`);
  for (const key of Object.keys(WORLD_LIMITS) as NumericKey[]) {
    const value = config[key];
    const integer = INTEGER_KEYS.has(key);
    if (
      !inRange(value, WORLD_LIMITS[key]) ||
      (integer && !Number.isInteger(value))
    )
      throw new RangeError(
        `Invalid ${key}: expected [${WORLD_LIMITS[key].join(", ")}]${integer ? " integer" : ""}`,
      );
  }
  if (config.cameraWidth % 4 !== 0 || config.projectorWidth % 4 !== 0)
    throw new RangeError("Image widths must be multiples of 4 (4:3 images)");
  if (
    config.fringeAmplitude >
    Math.min(config.fringeOffset, 1 - config.fringeOffset) + 1e-9
  )
    throw new RangeError(
      "fringeAmplitude must keep the pattern inside [0, 1] (≤ offset and ≤ 1 − offset)",
    );
  if (config.coding !== "dual" && !Number.isInteger(config.fringeFrequency))
    throw new RangeError(
      "fringeFrequency must be an integer unless coding is dual",
    );
  const aim = rigTarget(config);
  for (const [list, label, active] of [
    [config.cameras, "camera", config.activeCamera],
    [config.projectors, "projector", config.activeProjector],
  ] as const) {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_DEVICES)
      throw new RangeError(`Need 1–${MAX_DEVICES} ${label}s`);
    const ids = new Set<string>();
    for (const device of list) {
      if (typeof device?.id !== "string" || !device.id || ids.has(device.id))
        throw new RangeError(`${label} ids must be unique non-empty strings`);
      ids.add(device.id);
      if (typeof device.name !== "string")
        throw new RangeError(`${label} name must be a string`);
      for (const key of Object.keys(
        DEVICE_LIMITS,
      ) as (keyof typeof DEVICE_LIMITS)[])
        if (!inRange(device[key], DEVICE_LIMITS[key]))
          throw new RangeError(
            `Invalid ${label} ${device.id} ${key}: expected [${DEVICE_LIMITS[key].join(", ")}]`,
          );
      if (
        Math.hypot(...devicePosition(device).map((v, axis) => v - aim[axis])) <
        RIG_MIN_DISTANCE
      )
        throw new RangeError(
          `${label} ${device.id} must stay at least ${RIG_MIN_DISTANCE} mm from the aim point`,
        );
    }
    if (typeof active !== "string" || !ids.has(active))
      throw new RangeError(`Active ${label} must be one of the ${label}s`);
  }
  for (const kind of PAIR_CLASSES) {
    const r = config.references?.[kind];
    if (!r || typeof r.note !== "string")
      throw new RangeError(`Invalid reference for ${kind}`);
    for (const value of [
      r.heightPer2Pi,
      r.range,
      r.sensitivityRatio,
      r.noiseRatio,
    ])
      if (value !== null && !inRange(value, [0, 1000]))
        throw new RangeError(`Invalid reference value for ${kind}`);
  }
}

const own = (record: Record<string, unknown>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** Validate an import and discard unknown fields; numeric strings are never coerced. */
export function parseWorldConfig(value: unknown): WorldConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RangeError("World config must be an object");
  const record = value as Record<string, unknown>;
  const text = (key: string) => {
    const v = own(record, key);
    if (typeof v !== "string") throw new RangeError(`${key} must be a string`);
    return v;
  };
  const devices = (key: string): Device[] => {
    const list = own(record, key);
    if (!Array.isArray(list)) throw new RangeError(`${key} must be an array`);
    return list.map((d) => {
      if (typeof d !== "object" || d === null || Array.isArray(d))
        throw new RangeError(`${key} entries must be objects`);
      const x = d as Record<string, unknown>;
      const device = {} as Record<string, unknown>;
      for (const k of ["id", "name"])
        if (typeof own(x, k) !== "string")
          throw new RangeError(`${key} ${k} must be a string`);
        else device[k] = x[k];
      for (const k of Object.keys(DEVICE_LIMITS))
        if (typeof own(x, k) !== "number")
          throw new RangeError(`${key} ${k} must be a number`);
        else device[k] = x[k];
      return device as unknown as Device;
    });
  };
  const references = own(record, "references");
  if (typeof references !== "object" || references === null)
    throw new RangeError("references must be an object");
  const result = {
    shape: text("shape"),
    coding: text("coding"),
    activeCamera: text("activeCamera"),
    activeProjector: text("activeProjector"),
    cameras: devices("cameras"),
    projectors: devices("projectors"),
    references: Object.fromEntries(
      PAIR_CLASSES.map((kind) => {
        const r = own(references as Record<string, unknown>, kind);
        if (typeof r !== "object" || r === null)
          throw new RangeError(`references.${kind} must be an object`);
        const x = r as Record<string, unknown>;
        return [
          kind,
          {
            heightPer2Pi: own(x, "heightPer2Pi") as number | null,
            range: own(x, "range") as number | null,
            sensitivityRatio: (own(x, "sensitivityRatio") ?? null) as
              number | null,
            noiseRatio: (own(x, "noiseRatio") ?? null) as number | null,
            note: own(x, "note") as string,
          },
        ];
      }),
    ),
  } as unknown as WorldConfig;
  for (const key of BOOLEAN_KEYS) {
    const flag = own(record, key);
    if (typeof flag !== "boolean")
      throw new RangeError(`${key} must be a boolean`);
    result[key] = flag;
  }
  for (const key of Object.keys(WORLD_LIMITS) as NumericKey[]) {
    const v = own(record, key);
    if (typeof v !== "number") throw new RangeError(`${key} must be a number`);
    (result as unknown as Record<string, number>)[key] = v;
  }
  validateWorldConfig(result);
  return result;
}

/** Earlier (schema ≤ 4) sandbox config: one camera and projector, lengths in 25 mm units. */
export interface LegacyWorldConfig {
  shape: string;
  x: number;
  y: number;
  z: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  projectorX: number;
  projectorY: number;
  projectorZ: number;
  cameraFov: number;
  projectorFov?: number;
  temporalUnwrap?: boolean;
  [key: string]: unknown;
}

const LEGACY_LENGTHS = ["x", "y", "z"] as const;
/** Upgrade a schema-4 config: lengths ×25 mm, the single rig becomes C0/P0, unwrapping maps to coding. */
export function migrateLegacyConfig(value: unknown): WorldConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RangeError("Legacy config must be an object");
  const old = value as Record<string, unknown>;
  const num = (key: string) => {
    const v = own(old, key);
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new RangeError(`${key} must be a number`);
    return v;
  };
  const shape = own(old, "shape");
  if (
    typeof shape !== "string" ||
    !["sphere", "box", "ramp", "vgroove", "pcb"].includes(shape)
  )
    throw new RangeError("Unknown legacy shape");
  const s = LEGACY_UNIT_MM;
  const next: Record<string, unknown> = { ...DEFAULT_WORLD, shape };
  for (const key of LEGACY_LENGTHS) next[key] = num(key) * s;
  for (const key of [
    "grooveAngle",
    "cameraWidth",
    "pixelGrid",
    "seed",
    "noiseSigma",
    "fringeFrequency",
    "phaseSteps",
    "fringeOffset",
    "fringeAmplitude",
    "bounces",
    "giSamples",
    ...["object", "ground", "chip", "pin"].flatMap((m) =>
      ["Albedo", "Specular", "Roughness"].map((p) => `${m}${p}`),
    ),
  ])
    if (Object.hasOwn(old, key)) next[key] = num(key);
  if (Object.hasOwn(old, "interreflection"))
    next.interreflection = old.interreflection;
  if (Object.hasOwn(old, "temporalUnwrap"))
    next.coding = old.temporalUnwrap === false ? "single" : "temporal";
  if (shape === "pcb") next.referenceHeight = num("y") * s + PCB_BOARD_TOP * s;
  next.cameras = [
    {
      id: "C0",
      name: "Camera",
      x: num("cameraX") * s,
      y: num("cameraY") * s,
      z: num("cameraZ") * s,
      fov: num("cameraFov"),
      aperture: 0,
    },
  ];
  next.projectors = [
    {
      id: "P0",
      name: "Projector",
      x: num("projectorX") * s,
      y: num("projectorY") * s,
      z: num("projectorZ") * s,
      fov: Object.hasOwn(old, "projectorFov") ? num("projectorFov") : 55,
      aperture: 0,
    },
  ];
  next.activeCamera = "C0";
  next.activeProjector = "P0";
  return parseWorldConfig(next);
}

/** V-groove block (40 × 20 × 30 mm) whose groove runs along Z, centred at the origin. */
function vGrooveGeometry(angleDegrees: number): THREE.BufferGeometry {
  const halfWidth = 0.8,
    halfHeight = 0.4,
    tan = Math.tan((angleDegrees * Math.PI) / 360),
    depth = Math.min(0.6, 0.7 / tan),
    opening = depth * tan;
  const shape = new THREE.Shape([
    new THREE.Vector2(-halfWidth, -halfHeight),
    new THREE.Vector2(halfWidth, -halfHeight),
    new THREE.Vector2(halfWidth, halfHeight),
    new THREE.Vector2(opening, halfHeight),
    new THREE.Vector2(0, halfHeight - depth),
    new THREE.Vector2(-opening, halfHeight),
    new THREE.Vector2(-halfWidth, halfHeight),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.2,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.6);
  geometry.scale(LEGACY_UNIT_MM, LEGACY_UNIT_MM, LEGACY_UNIT_MM);
  return geometry;
}

function objectGeometry(config: WorldConfig): THREE.BufferGeometry {
  const s = LEGACY_UNIT_MM;
  switch (config.shape) {
    case "sphere":
      return new THREE.SphereGeometry(0.65 * s, 24, 16);
    case "box":
      return new THREE.BoxGeometry(1.2 * s, 1.2 * s, 1.2 * s);
    case "ramp":
      return new THREE.BoxGeometry(1.5 * s, 0.4 * s, 1.2 * s);
    case "vgroove":
      return vGrooveGeometry(config.grooveAngle);
    case "pcb": {
      const { geometry } = buildPcbGeometry();
      return geometry.scale(s, s, s);
    }
    default:
      return buildBoardScene(config.shape);
  }
}

export const GROUND_SIZE = 250;

export function createWorld(config: WorldConfig): {
  scene: THREE.Scene;
  object: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  ground: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
  dispose: () => void;
} {
  validateWorldConfig(config);
  const scene = new THREE.Scene();
  const object = new THREE.Mesh(
    objectGeometry(config),
    new THREE.MeshBasicMaterial({ color: 0x5bbdcd, side: THREE.DoubleSide }),
  );
  object.position.set(config.x, config.y, config.z);
  if (config.shape === "ramp") object.rotation.z = -0.35;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshBasicMaterial({ color: 0x57647b, side: THREE.DoubleSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(object, ground);
  scene.updateMatrixWorld(true);
  const meshes = [object, ground];
  const owned = meshes.map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material,
  }));
  return {
    scene,
    object,
    ground,
    meshes,
    dispose: () => {
      for (const resource of owned) {
        resource.geometry.dispose();
        resource.material.dispose();
      }
      scene.clear();
    },
  };
}

/** Materials indexed by SURFACE slot: object/board, ground, component body, pin/electrode, solder. */
export const surfaceMaterials = (config: WorldConfig): SurfaceMaterial[] =>
  (["object", "ground", "chip", "pin", "solder"] as const).map((prefix) => ({
    albedo: config[`${prefix}Albedo`],
    specular: config[`${prefix}Specular`],
    roughness: config[`${prefix}Roughness`],
  }));

export interface WorldCaptures {
  width: number;
  height: number;
  /** One image per entry of fringePatterns(config). */
  frames: Float64Array[];
  clipped: Uint8Array;
  /** Camera optical-axis depth, evaluation only. Never passed to reconstruction. */
  truthDepth: Float64Array;
  cameraHit: Uint8Array;
  /** Camera hits unilluminated by the projector (occlusion, outside FoV, or back-facing). */
  shadowMask: Uint8Array;
  /** Material slot seen by each pixel (see SURFACE), 255 for background; evaluation only. */
  surface: Uint8Array;
  /** PCB pin seen by each pixel, −1 elsewhere; evaluation only. */
  pinId: Int16Array;
  /** Forward-model light components (no ambient, noise or clipping); evaluation only. */
  direct: Float64Array[];
  indirect: Float64Array[];
  /** Counterfactual captures without interreflection, same noise; evaluation only. */
  directOnly: {
    frames: Float64Array[];
    clipped: Uint8Array;
  } | null;
}

/** Constant camera offset (ambient + black level) in normalized intensity. */
export const AMBIENT = 0.12;

export type FringeCoding = Pick<
  WorldConfig,
  "fringeFrequency" | "phaseSteps" | "coding" | "periodRatio"
>;
export interface FringePattern {
  frequency: number;
  shift: number;
}
/**
 * Capture order: N shifted fine patterns, then N coarse ones — unit frequency
 * (temporal, only when f > 1) or f/periodRatio (dual heterodyne, coarse/fine).
 */
export function fringePatterns(coding: FringeCoding): FringePattern[] {
  const n = coding.phaseSteps;
  const set = (frequency: number) =>
    Array.from({ length: n }, (_, k) => ({ frequency, shift: (TAU * k) / n }));
  const fine = set(coding.fringeFrequency);
  if (coding.coding === "dual" || coding.coding === "coarse")
    return [...fine, ...set(coding.fringeFrequency / coding.periodRatio)];
  if (coding.coding === "temporal" && coding.fringeFrequency > 1)
    return [...fine, ...set(1)];
  return fine;
}
/** Projector gray level at column u; phase φ = 2πf(u + ½)/W − π spans f periods. `contrast` scales the AC term (e.g. defocus MTF). */
export const fringeIntensity = (
  u: number,
  width: number,
  pattern: FringePattern,
  offset: number,
  amplitude: number,
  contrast = 1,
) =>
  offset +
  amplitude *
    contrast *
    Math.cos(
      (TAU * pattern.frequency * (u + 0.5)) / width - Math.PI + pattern.shift,
    );
const stack = (frames: number, count: number) =>
  Array.from({ length: frames }, () => new Float64Array(count));

export const insideProjector = (
  projector: Pinhole,
  p: { u: number; v: number } | null,
): boolean =>
  !!p &&
  p.u >= -0.5 &&
  p.u < projector.width - 0.5 &&
  p.v >= -0.5 &&
  p.v < projector.height - 0.5;

export function activeDevices(config: WorldConfig): {
  camera: Device;
  projector: Device;
} {
  return {
    camera: config.cameras.find((d) => d.id === config.activeCamera)!,
    projector: config.projectors.find((d) => d.id === config.activeProjector)!,
  };
}

/** Optical-axis depth the device is focused at. */
export const focusDepth = (pinhole: Pinhole, config: WorldConfig) =>
  projectPoint(pinhole, focusPoint(config))?.depth ??
  Math.hypot(...pinhole.position.map((v, i) => v - rigTarget(config)[i]));

/** Projector-side defocus contrast for each pattern at a point of projector depth `depth`. */
export function projectorContrast(
  projector: Pinhole,
  device: Device,
  config: WorldConfig,
  patterns: readonly FringePattern[],
  depth: number,
  out: Float64Array,
) {
  const sigma =
    config.defocus && device.aperture > 0
      ? blurSigma(
          blurDiameter(
            projector.fx,
            device.aperture,
            depth,
            focusDepth(projector, config),
          ),
        )
      : 0;
  for (let k = 0; k < patterns.length; k++)
    out[k] =
      sigma > 0
        ? gaussianMtf(sigma, projector.width / patterns[k].frequency)
        : 1;
}

/** Camera-side defocus σ per pixel from the forward model's depth; 0 for background. */
export function cameraBlurSigma(
  camera: Pinhole,
  device: Device,
  config: WorldConfig,
  depth: Float64Array,
): Float64Array | null {
  if (!config.defocus || device.aperture === 0) return null;
  const focus = focusDepth(camera, config);
  return depth.map((d) =>
    Number.isFinite(d)
      ? blurSigma(blurDiameter(camera.fx, device.aperture, d, focus))
      : 0,
  );
}

/**
 * CPU float64 light transport on the very same triangle meshes used by the UI:
 * projector point light with exact visibility, GGX + Lambert BRDF, thin-lens
 * defocus, and optional Monte Carlo interreflection (next-event estimation at every bounce).
 */
export function captureWorld(
  config: WorldConfig,
  width = config.cameraWidth,
  height = cameraHeight(config),
  onProgress?: (fraction: number) => void,
): WorldCaptures {
  const { camera, projector } = getRig(config, width, height);
  const devices = activeDevices(config);
  const world = createWorld(config);
  const scene = buildTraceScene(world.meshes);
  const materials = surfaceMaterials(config);
  const count = width * height;
  const patterns = fringePatterns(config),
    frameCount = patterns.length;
  const capture: WorldCaptures = {
    width,
    height,
    frames: stack(frameCount, count),
    clipped: new Uint8Array(count),
    truthDepth: new Float64Array(count).fill(NaN),
    cameraHit: new Uint8Array(count),
    shadowMask: new Uint8Array(count),
    surface: new Uint8Array(count).fill(255),
    pinId: new Int16Array(count).fill(-1),
    direct: stack(frameCount, count),
    indirect: stack(frameCount, count),
    directOnly: config.interreflection
      ? { frames: stack(frameCount, count), clipped: new Uint8Array(count) }
      : null,
  };
  const cameraOrigin = new THREE.Vector3(...camera.position),
    projectorOrigin = new THREE.Vector3(...projector.position),
    direction = new THREE.Vector3(),
    toProjector = new THREE.Vector3(),
    fromProjector = new THREE.Vector3(),
    wo = new THREE.Vector3(),
    wi = new THREE.Vector3(),
    origin = new THREE.Vector3();
  const contrast = new Float64Array(frameCount);
  // Leaves the unit direction to the projector in toProjector and the defocus contrast in `contrast`.
  const illuminate = (point: THREE.Vector3, normal: THREE.Vector3) => {
    const pp = projectPoint(projector, [point.x, point.y, point.z]);
    if (!pp || !insideProjector(projector, pp)) return null;
    toProjector.subVectors(projectorOrigin, point);
    const distance = toProjector.length();
    toProjector.divideScalar(distance);
    const cos = normal.dot(toProjector);
    if (cos <= 0) return null;
    // Visible when nothing lies strictly before the point; robust to shared-edge cracks.
    const blocker = scene.trace(
      projectorOrigin,
      fromProjector.copy(toProjector).negate(),
      0,
      distance - 1e-6 * Math.max(1, distance),
    );
    if (blocker) return null;
    projectorContrast(
      projector,
      devices.projector,
      config,
      patterns,
      pp.depth,
      contrast,
    );
    return { u: pp.u, cos };
  };
  const pattern = (u: number, k: number) =>
    fringeIntensity(
      u,
      projector.width,
      patterns[k],
      config.fringeOffset,
      config.fringeAmplitude,
      contrast[k],
    );
  const giRandom = createSeededRandom((config.seed ^ 0x9e3779b9) >>> 0);
  const directSum = new Array<number>(frameCount).fill(0),
    indirectSum = new Array<number>(frameCount).fill(0);
  const grid = config.pixelGrid,
    subpixels = grid * grid,
    pathsPerSubpixel = config.interreflection
      ? Math.max(1, Math.round(config.giSamples / subpixels))
      : 0;
  const subRay = new THREE.Vector3();
  // Adds one camera ray's direct and indirect radiance to the per-pixel sums.
  const shade = (hit: NonNullable<ReturnType<typeof scene.trace>>) => {
    if (hit.normal.dot(wo) <= 0) return;
    const lit = illuminate(hit.point, hit.normal);
    if (lit) {
      const radiance =
        evaluateBrdf(materials[hit.mesh], hit.normal, toProjector, wo) *
        lit.cos;
      for (let k = 0; k < frameCount; k++)
        directSum[k] += radiance * pattern(lit.u, k);
    }
    for (let s = 0; s < pathsPerSubpixel; s++) {
      let throughput = 1,
        point = hit.point,
        normal = hit.normal,
        material = materials[hit.mesh];
      const pathWo = wo.clone();
      for (let bounce = 0; bounce < config.bounces; bounce++) {
        const weight = sampleBrdf(material, normal, pathWo, giRandom, wi);
        if (weight <= 0) break;
        throughput *= weight;
        origin.copy(point).addScaledVector(normal, 1e-5 * LEGACY_UNIT_MM);
        const next = scene.trace(origin, wi);
        if (!next) break;
        pathWo.copy(wi).negate();
        if (next.normal.dot(pathWo) <= 0) break;
        const light = illuminate(next.point, next.normal);
        if (light) {
          const contribution =
            throughput *
            evaluateBrdf(
              materials[next.mesh],
              next.normal,
              toProjector,
              pathWo,
            ) *
            light.cos;
          for (let k = 0; k < frameCount; k++)
            indirectSum[k] += contribution * pattern(light.u, k);
        }
        point = next.point;
        normal = next.normal;
        material = materials[next.mesh];
      }
    }
  };
  try {
    for (let i = 0; i < count; i++) {
      const px = i % width,
        py = Math.floor(i / width);
      if (onProgress && px === 0) onProgress(py / height);
      // The pixel-centre ray defines truth, surface labels and the shadow mask.
      direction.fromArray(cameraRay(camera, px, py));
      const hit = scene.trace(cameraOrigin, direction);
      if (hit) {
        capture.cameraHit[i] = 1;
        capture.surface[i] = hit.mesh;
        capture.pinId[i] = hit.pin;
        capture.truthDepth[i] = projectPoint(
          camera,
          hit.point.toArray(),
        )!.depth;
        wo.copy(direction).negate();
        capture.shadowMask[i] =
          hit.normal.dot(wo) > 0 && illuminate(hit.point, hit.normal) ? 0 : 1;
      }
      directSum.fill(0);
      indirectSum.fill(0);
      for (let sy = 0; sy < grid; sy++)
        for (let sx = 0; sx < grid; sx++) {
          if (grid === 1) {
            if (hit) shade(hit);
            continue;
          }
          // Pixel-area integration: mixed pixels blend neighbouring surfaces.
          subRay.fromArray(
            cameraRay(
              camera,
              px + (sx + 0.5) / grid - 0.5,
              py + (sy + 0.5) / grid - 0.5,
            ),
          );
          const sub = scene.trace(cameraOrigin, subRay);
          if (!sub) continue;
          wo.copy(subRay).negate();
          shade(sub);
        }
      // π maps radiance to normalized intensity: a white Lambertian facing the projector reads p_k.
      const gain = (Math.PI * config.exposure) / subpixels;
      for (let k = 0; k < frameCount; k++) {
        capture.direct[k][i] = gain * directSum[k];
        if (pathsPerSubpixel)
          capture.indirect[k][i] = (gain * indirectSum[k]) / pathsPerSubpixel;
      }
    }
    const sigma = cameraBlurSigma(
      camera,
      devices.camera,
      config,
      capture.truthDepth,
    );
    if (sigma) {
      capture.direct = scatterBlur(capture.direct, width, height, sigma);
      if (pathsPerSubpixel)
        capture.indirect = scatterBlur(capture.indirect, width, height, sigma);
    }
    const random = createSeededRandom(config.seed);
    const gaussian = () =>
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
    const expose = (
      value: number,
      target: { frames: Float64Array[]; clipped: Uint8Array },
      i: number,
      k: number,
    ) => {
      if (value <= 0 || value >= 1) target.clipped[i] = 1;
      target.frames[k][i] = Math.max(0, Math.min(1, value));
    };
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < frameCount; k++) {
        const noise =
          config.noiseSigma === 0 ? 0 : config.noiseSigma * gaussian();
        const direct = AMBIENT + capture.direct[k][i] + noise;
        expose(direct + capture.indirect[k][i], capture, i, k);
        if (capture.directOnly) expose(direct, capture.directOnly, i, k);
      }
    }
    onProgress?.(1);
    return capture;
  } finally {
    scene.dispose();
    world.dispose();
  }
}

/** Everything the inverse knows: pattern coding, sensor spec and the calibrated reference window. */
export interface ReconstructionCoding extends FringeCoding {
  /** Absolute world height of the phase-window bottom, mm. */
  windowBottom: number;
  minModulation: number;
  /** Camera read-noise specification; only weights measurements. */
  sensorNoise: number;
}

export const codingOf = (config: WorldConfig): ReconstructionCoding => ({
  fringeFrequency: config.fringeFrequency,
  phaseSteps: config.phaseSteps,
  coding: config.coding,
  periodRatio: config.periodRatio,
  windowBottom: config.referenceHeight + config.windowBottom,
  minModulation: config.minModulation,
  sensorNoise: config.noiseSigma,
});

export interface WorldReconstruction {
  /** Wrapped phase of the fine patterns. */
  phase: PhaseResult;
  /** Coarse phase (unit frequency or f/periodRatio), when projected. */
  lowPhase: PhaseResult | null;
  /** Absolute fine phase in the φ convention (equals φ̂ + 2πk). */
  absolute: Float64Array;
  /** Decoded projector column. */
  column: Float64Array;
  depth: Float64Array;
  points: Float64Array;
  valid: Uint8Array;
  validCount: number;
  /** |dφ/dh| at the reconstructed point, rad/mm. */
  sensitivity: Float64Array;
  /** Predicted height noise from B, sensor noise and |dφ/dh|, mm. */
  sigmaHeight: Float64Array;
}

const DEFAULT_CODING = codingOf(DEFAULT_WORLD);
const wrap2Pi = (x: number) => ((x % TAU) + TAU) % TAU;
/** Choose the 2π branch that puts the point inside [bottom, bottom + range) along the camera ray. */
const windowed = (wrapped: number, reference: number, direction: number) =>
  reference + direction * wrap2Pi(direction * (wrapped - reference));
/** Floor so that a noiseless simulation still yields finite fusion weights. */
const NOISE_FLOOR = 1e-4;

/** Unwrapped projector phase ψ = 2πf(u + ½)/W at a world point. */
export function projectorPhase(
  projector: Pinhole,
  frequency: number,
  point: Vec3,
): number | null {
  const p = projectPoint(projector, point);
  return p ? (TAU * frequency * (p.u + 0.5)) / projector.width : null;
}

/** World-space gradient of ψ; exact derivative of the pinhole projection. */
export function phaseGradient(
  projector: Pinhole,
  frequency: number,
  point: Vec3,
): Vec3 | null {
  const o = point.map((v, i) => v - projector.position[i]);
  const a = o.reduce((s, v, i) => s + v * projector.right[i], 0),
    b = o.reduce((s, v, i) => s + v * projector.forward[i], 0);
  if (!(b > 0)) return null;
  const k = (TAU * frequency * projector.fx) / (projector.width * b * b);
  return [0, 1, 2].map(
    (i) => k * (projector.right[i] * b - projector.forward[i] * a),
  ) as Vec3;
}

/** dψ/dh in rad/mm for a fixed camera pixel as the point slides along its ray in height (world Y). */
export function heightSensitivity(
  camera: Pinhole,
  projector: Pinhole,
  frequency: number,
  point: Vec3,
): number {
  const ray = point.map((v, i) => v - camera.position[i]);
  const gradient = phaseGradient(projector, frequency, point);
  if (!gradient || Math.abs(ray[1]) < 1e-12) return NaN;
  return (
    (gradient[0] * ray[0] + gradient[1] * ray[1] + gradient[2] * ray[2]) /
    ray[1]
  );
}

/** Least-squares N-step phase noise: σφ = σI·√(2/N) / B. */
export const phaseNoise = (
  sigmaI: number,
  steps: number,
  modulation: number,
) => (modulation > 0 ? (sigmaI * Math.sqrt(2 / steps)) / modulation : Infinity);

/**
 * Inverse boundary: only intensities, clipping flags, the known pattern coding
 * and calibration enter. Ambiguous phases are resolved on the calibrated
 * reference window (single / dual) or by the unit-frequency phase (temporal).
 */
export function reconstructCaptures(
  captures: Pick<WorldCaptures, "width" | "height" | "frames" | "clipped">,
  camera: Pinhole,
  projector: Pinhole,
  coding: ReconstructionCoding = DEFAULT_CODING,
): WorldReconstruction {
  const { width, height, frames, clipped } = captures;
  const count = width * height;
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    !Number.isSafeInteger(count) ||
    camera.width !== width ||
    camera.height !== height ||
    frames.length !== fringePatterns(coding).length ||
    frames.some((frame) => frame.length !== count) ||
    clipped.length !== count
  )
    throw new RangeError(
      "Capture dimensions, frame count and lengths, clipping mask and camera calibration must match",
    );
  const n = coding.phaseSteps,
    f1 = coding.fringeFrequency;
  const phase = decodeNStep(frames.slice(0, n), coding.minModulation, clipped);
  const lowPhase =
    frames.length > n
      ? decodeNStep(frames.slice(n), coding.minModulation, clipped)
      : null;
  const f2 =
    coding.coding === "dual" || coding.coding === "coarse"
      ? f1 / coding.periodRatio
      : lowPhase
        ? 1
        : 0;
  // Frequency whose wrapped phase must be placed on the reference window (≤ 1 needs none).
  const windowFrequency =
    coding.coding === "dual"
      ? f1 - f2
      : coding.coding === "coarse"
        ? f2
        : coding.coding === "single"
          ? f1
          : 0;
  const result: WorldReconstruction = {
    phase,
    lowPhase,
    absolute: new Float64Array(count).fill(NaN),
    column: new Float64Array(count).fill(NaN),
    depth: new Float64Array(count).fill(NaN),
    points: new Float64Array(3 * count).fill(NaN),
    valid: new Uint8Array(count),
    validCount: 0,
    sensitivity: new Float64Array(count).fill(NaN),
    sigmaHeight: new Float64Array(count).fill(NaN),
  };
  const sensor = Math.max(coding.sensorNoise, NOISE_FLOOR);
  for (let i = 0; i < count; i++) {
    if (!phase.valid[i] || (lowPhase && !lowPhase.valid[i])) continue;
    const x = i % width,
      y = Math.floor(i / width);
    const psi1 = wrap2Pi(phase.wrapped[i] + Math.PI);
    const psi2 = lowPhase ? wrap2Pi(lowPhase.wrapped[i] + Math.PI) : NaN;
    let coarse: number;
    if (coding.coding === "temporal")
      coarse = lowPhase ? (psi2 * f1) / f2 : psi1;
    else {
      const wrapped =
        coding.coding === "dual"
          ? wrap2Pi(psi1 - psi2)
          : coding.coding === "coarse"
            ? psi2
            : psi1;
      let placed = wrapped;
      if (windowFrequency > 1) {
        const ray = cameraRay(camera, x, y);
        if (Math.abs(ray[1]) < 1e-12) continue;
        const t = (coding.windowBottom - camera.position[1]) / ray[1];
        if (!(t > 0)) continue;
        const bottom = camera.position.map((c, k) => c + t * ray[k]) as Vec3;
        const reference = projectorPhase(projector, windowFrequency, bottom);
        const slope = heightSensitivity(camera, projector, 1, bottom);
        if (reference === null || !Number.isFinite(slope) || slope === 0)
          continue;
        placed = windowed(wrapped, reference, Math.sign(slope));
      }
      coarse =
        coding.coding === "single" ? placed : (placed * f1) / windowFrequency;
    }
    const psi = psi1 + TAU * Math.round((coarse - psi1) / TAU);
    const u = (projector.width * psi) / (TAU * f1) - 0.5;
    if (!Number.isFinite(u) || u < -0.5 || u >= projector.width - 0.5) continue;
    const point = triangulateColumn(camera, projector, x, y, u);
    if (!point) continue;
    const cp = projectPoint(camera, point);
    if (!cp || !insideProjector(projector, projectPoint(projector, point)))
      continue;
    const sensitivity = Math.abs(
      heightSensitivity(camera, projector, f1, point),
    );
    result.depth[i] = cp.depth;
    result.absolute[i] = psi - Math.PI;
    result.column[i] = u;
    result.points.set(point, 3 * i);
    result.valid[i] = 1;
    result.validCount++;
    result.sensitivity[i] = sensitivity;
    result.sigmaHeight[i] =
      phaseNoise(sensor, n, phase.modulation[i]) / sensitivity;
  }
  return result;
}

export interface WorldScan {
  capture: WorldCaptures;
  reconstruction: WorldReconstruction;
  /** Same pipeline on the no-interreflection counterfactual; evaluation only. */
  directReconstruction: WorldReconstruction | null;
  camera: Pinhole;
  projector: Pinhole;
  metrics: {
    rmseDepth: number | null;
    directRmseDepth: number | null;
    validCount: number;
    cameraHitCount: number;
    totalCount: number;
    validRatio: number;
    occludedCount: number;
    evaluatedCount: number;
  };
}

function depthRmse(
  reconstruction: WorldReconstruction,
  truthDepth: Float64Array,
): { rmse: number | null; count: number } {
  let squaredError = 0,
    count = 0;
  for (let i = 0; i < truthDepth.length; i++) {
    if (!reconstruction.valid[i] || !Number.isFinite(truthDepth[i])) continue;
    squaredError += (reconstruction.depth[i] - truthDepth[i]) ** 2;
    count++;
  }
  return { rmse: count ? Math.sqrt(squaredError / count) : null, count };
}

export function runWorldScan(
  config: WorldConfig,
  width = config.cameraWidth,
  height = cameraHeight(config),
  onProgress?: (fraction: number) => void,
): WorldScan {
  const { camera, projector } = getRig(config, width, height);
  const capture = captureWorld(config, width, height, onProgress);
  const coding = codingOf(config);
  // Intentionally construct an explicit field-only payload: truth and visibility never cross this boundary.
  const reconstruction = reconstructCaptures(
    { width, height, frames: capture.frames, clipped: capture.clipped },
    camera,
    projector,
    coding,
  );
  const directReconstruction = capture.directOnly
    ? reconstructCaptures(
        {
          width,
          height,
          frames: capture.directOnly.frames,
          clipped: capture.directOnly.clipped,
        },
        camera,
        projector,
        coding,
      )
    : null;
  let cameraHitCount = 0,
    occludedCount = 0;
  const totalCount = width * height;
  for (let i = 0; i < totalCount; i++) {
    cameraHitCount += capture.cameraHit[i];
    occludedCount += capture.shadowMask[i];
  }
  const evaluated = depthRmse(reconstruction, capture.truthDepth);
  return {
    capture,
    reconstruction,
    directReconstruction,
    camera,
    projector,
    metrics: {
      rmseDepth: evaluated.rmse,
      directRmseDepth: directReconstruction
        ? depthRmse(directReconstruction, capture.truthDepth).rmse
        : null,
      validCount: reconstruction.validCount,
      cameraHitCount,
      totalCount,
      validRatio: reconstruction.validCount / totalCount,
      occludedCount,
      evaluatedCount: evaluated.count,
    },
  };
}

/** Calibrated pinholes for any camera / projector of the config (defaults to the active pair). */
export function pinholesFor(
  config: WorldConfig,
  camera: Device,
  projector: Device,
  width = config.cameraWidth,
  height = (width * 3) / 4,
): { camera: Pinhole; projector: Pinhole } {
  const aim = rigTarget(config);
  return {
    camera: cameraPinhole(camera, aim, width, height),
    projector: projectorPinhole(projector, aim, config.projectorWidth),
  };
}

export function getRig(
  config: WorldConfig,
  width = config.cameraWidth,
  height = cameraHeight(config),
): { camera: Pinhole; projector: Pinhole } {
  validateWorldConfig(config);
  const { camera, projector } = activeDevices(config);
  return pinholesFor(config, camera, projector, width, height);
}
