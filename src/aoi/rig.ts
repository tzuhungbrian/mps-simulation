import { makePinhole, type Pinhole, type Vec3 } from "../sandbox/geometry";
import type { SurfaceMaterial } from "../sandbox/lightTransport";

/**
 * AOI multi-view rig. Units are millimetres; world Y is height above the
 * reference (board) plane. Board coordinates: x = world X, y = world Z.
 * Azimuth is measured in the board plane from +x toward +y.
 */
export interface AoiDevice {
  id: string;
  name: string;
  /** Angle from the vertical (0 = looking straight down), degrees. */
  tilt: number;
  /** Board-plane direction from the aim point toward the device, degrees. */
  azimuth: number;
  /** Distance from the aim point (origin), mm. */
  distance: number;
  /** Vertical field of view, degrees (images are 4:3). */
  fov: number;
  /** Entrance-pupil diameter for the thin-lens defocus model, mm (0 = pinhole). */
  aperture: number;
}

export const PAIR_CLASSES = [
  "direct",
  "opposite",
  "orthogonal",
  "same",
] as const;
export type PairClass = (typeof PAIR_CLASSES)[number];
export const PAIR_CLASS_NAMES: Record<PairClass, string> = {
  direct: "直視",
  opposite: "反対側",
  orthogonal: "直交",
  same: "同じ側",
};

export const AOI_SCENES = ["step", "chip", "pcb", "plane"] as const;
export type AoiScene = (typeof AOI_SCENES)[number];
export const PCB_REGIONS = ["passives", "qfp", "header"] as const;
export type PcbRegion = (typeof PCB_REGIONS)[number];
export const CODINGS = ["single", "dual", "temporal"] as const;
export type AoiCodingMode = (typeof CODINGS)[number];

export const MATERIAL_SLOTS = ["board", "body", "metal", "solder"] as const;
export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];
export const MATERIAL_SLOT_NAMES: Record<MaterialSlot, string> = {
  board: "板面 / 基準面",
  body: "元件本體 / 量規",
  metal: "電極 / 引腳",
  solder: "焊錫 Fillet",
};

export interface ClassReference {
  /** Height per fringe period (2π) reported by the AOI vendor or measured on the machine, mm. */
  heightPer2Pi: number | null;
  /** Measurement range reported by the AOI vendor or measured on the machine, mm. */
  range: number | null;
  note: string;
}

export interface AoiConfig {
  scene: AoiScene;
  pcbRegion: PcbRegion;
  /** Height of the flat plane in the "plane" scene, mm. */
  planeHeight: number;
  cameras: AoiDevice[];
  projectors: AoiDevice[];
  /** Pairs whose camera tilt is at most this are classified as 直視. */
  directTiltLimit: number;
  cameraWidth: number;
  projectorWidth: number;
  pixelGrid: number;
  phaseSteps: number;
  /** Fringe periods across the projector width for the primary (fine) pattern. */
  fringeFrequency: number;
  coding: AoiCodingMode;
  /** p₂ / p₁ for dual-period (heterodyne) coding; must be > 1. */
  periodRatio: number;
  /** Bottom of the phase window (calibrated reference plane + offset), mm. */
  windowBottom: number;
  fringeOffset: number;
  fringeAmplitude: number;
  exposure: number;
  noiseSigma: number;
  minModulation: number;
  seed: number;
  defocus: boolean;
  /** Every device focuses on this height at the aim point, mm. */
  focusHeight: number;
  roiWidth: number;
  roiHeight: number;
  cellSize: number;
  /** |error| at or below this counts as accurate, mm (evaluation only). */
  tolerance: number;
  /** Cross-pair agreement gate used by fusion, mm. */
  consistencyTolerance: number;
  /** Height range the AOI must cover, used for the period recommendation, mm. */
  targetRange: number;
  materials: Record<MaterialSlot, SurfaceMaterial>;
  references: Record<PairClass, ClassReference>;
}

const oblique = (
  kind: "C" | "P",
  index: number,
  azimuth: number,
  tilt: number,
  distance: number,
  fov: number,
  aperture: number,
): AoiDevice => ({
  id: `${kind}${index}`,
  name: `${kind === "C" ? "斜視 Camera" : "Projector"} ${azimuth}°`,
  tilt,
  azimuth,
  distance,
  fov,
  aperture,
});

export const DEFAULT_CAMERAS: AoiDevice[] = [
  {
    id: "C0",
    name: "直視 Camera",
    tilt: 0,
    azimuth: 0,
    distance: 110,
    fov: 6,
    aperture: 4,
  },
  ...[0, 90, 180, 270].map((a, i) => oblique("C", i + 1, a, 35, 110, 7.5, 4)),
];
export const DEFAULT_PROJECTORS: AoiDevice[] = [0, 90, 180, 270].map((a, i) =>
  oblique("P", i + 1, a, 30, 120, 8, 3),
);

const MATTE: Record<MaterialSlot, SurfaceMaterial> = {
  board: { albedo: 0.5, specular: 0, roughness: 0.6 },
  body: { albedo: 0.7, specular: 0, roughness: 0.5 },
  metal: { albedo: 0.6, specular: 0, roughness: 0.5 },
  solder: { albedo: 0.6, specular: 0, roughness: 0.5 },
};
const ASSEMBLY: Record<MaterialSlot, SurfaceMaterial> = {
  board: { albedo: 0.25, specular: 0.06, roughness: 0.45 },
  body: { albedo: 0.45, specular: 0.06, roughness: 0.35 },
  metal: { albedo: 0.15, specular: 0.6, roughness: 0.4 },
  solder: { albedo: 0.1, specular: 0.7, roughness: 0.3 },
};
/** Material defaults applied when a scene is chosen; the user can edit them afterwards. */
export const SCENE_MATERIALS: Record<
  AoiScene,
  Record<MaterialSlot, SurfaceMaterial>
> = {
  step: MATTE,
  plane: MATTE,
  chip: ASSEMBLY,
  pcb: ASSEMBLY,
};

const emptyReference = (): ClassReference => ({
  heightPer2Pi: null,
  range: null,
  note: "",
});

export const DEFAULT_AOI: AoiConfig = {
  scene: "step",
  pcbRegion: "passives",
  planeHeight: 0,
  cameras: DEFAULT_CAMERAS,
  projectors: DEFAULT_PROJECTORS,
  directTiltLimit: 10,
  cameraWidth: 192,
  projectorWidth: 640,
  pixelGrid: 1,
  phaseSteps: 4,
  fringeFrequency: 16,
  coding: "single",
  periodRatio: 1.25,
  windowBottom: -0.2,
  fringeOffset: 0.45,
  fringeAmplitude: 0.4,
  exposure: 1,
  noiseSigma: 0.003,
  minModulation: 0.015,
  seed: 7,
  defocus: true,
  focusHeight: 0,
  roiWidth: 8,
  roiHeight: 6,
  cellSize: 0.12,
  tolerance: 0.05,
  consistencyTolerance: 0.08,
  targetRange: 2,
  materials: MATTE,
  references: {
    direct: emptyReference(),
    opposite: emptyReference(),
    orthogonal: emptyReference(),
    same: emptyReference(),
  },
};

export const AOI_LIMITS = {
  planeHeight: [-3, 8],
  directTiltLimit: [0, 30],
  cameraWidth: [64, 384],
  projectorWidth: [160, 1920],
  pixelGrid: [1, 3],
  phaseSteps: [3, 12],
  fringeFrequency: [1, 128],
  periodRatio: [1.02, 8],
  windowBottom: [-5, 5],
  fringeOffset: [0.05, 0.95],
  fringeAmplitude: [0.01, 0.5],
  exposure: [0.1, 8],
  noiseSigma: [0, 0.05],
  minModulation: [0, 0.2],
  seed: [0, 4294967295],
  focusHeight: [-5, 10],
  roiWidth: [1, 20],
  roiHeight: [1, 20],
  cellSize: [0.02, 1],
  tolerance: [0.001, 2],
  consistencyTolerance: [0.001, 2],
  targetRange: [0.05, 20],
} as const;
export const DEVICE_LIMITS = {
  tilt: [0, 80],
  azimuth: [-360, 360],
  distance: [20, 500],
  fov: [1, 60],
  aperture: [0, 50],
} as const;
export const MAX_DEVICES = 8;
const INTEGER_KEYS = new Set([
  "cameraWidth",
  "projectorWidth",
  "pixelGrid",
  "phaseSteps",
  "seed",
]);

const inRange = (value: unknown, [lo, hi]: readonly [number, number]) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= lo &&
  value <= hi;

function validateMaterial(name: string, m: SurfaceMaterial) {
  if (
    !m ||
    !inRange(m.albedo, [0, 1]) ||
    !inRange(m.specular, [0, 1]) ||
    !inRange(m.roughness, [0.05, 1])
  )
    throw new RangeError(`Invalid material ${name}`);
}

export function validateAoiConfig(config: AoiConfig): void {
  if (!AOI_SCENES.includes(config.scene)) throw new RangeError("Unknown scene");
  if (!PCB_REGIONS.includes(config.pcbRegion))
    throw new RangeError("Unknown PCB region");
  if (!CODINGS.includes(config.coding)) throw new RangeError("Unknown coding");
  if (typeof config.defocus !== "boolean")
    throw new RangeError("defocus must be a boolean");
  for (const key of Object.keys(AOI_LIMITS) as (keyof typeof AOI_LIMITS)[]) {
    const value = config[key];
    if (
      !inRange(value, AOI_LIMITS[key]) ||
      (INTEGER_KEYS.has(key) && !Number.isInteger(value))
    )
      throw new RangeError(
        `Invalid ${key}: expected [${AOI_LIMITS[key].join(", ")}]`,
      );
  }
  if (config.cameraWidth % 4 !== 0 || config.projectorWidth % 4 !== 0)
    throw new RangeError("Image widths must be multiples of 4 (4:3 images)");
  if (
    config.fringeAmplitude >
    Math.min(config.fringeOffset, 1 - config.fringeOffset) + 1e-9
  )
    throw new RangeError("fringeAmplitude must keep the pattern inside [0, 1]");
  if (
    config.coding === "dual" &&
    config.fringeFrequency / config.periodRatio < 0.5
  )
    throw new RangeError(
      "Dual coding needs fringeFrequency / periodRatio ≥ 0.5",
    );
  for (const [list, label] of [
    [config.cameras, "camera"],
    [config.projectors, "projector"],
  ] as const) {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_DEVICES)
      throw new RangeError(`Need 1–${MAX_DEVICES} ${label}s`);
    const ids = new Set<string>();
    for (const device of list) {
      if (typeof device.id !== "string" || !device.id || ids.has(device.id))
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
    }
  }
  for (const slot of MATERIAL_SLOTS)
    validateMaterial(slot, config.materials?.[slot]);
  for (const kind of PAIR_CLASSES) {
    const r = config.references?.[kind];
    if (!r || typeof r.note !== "string")
      throw new RangeError(`Invalid reference for ${kind}`);
    for (const value of [r.heightPer2Pi, r.range])
      if (value !== null && !inRange(value, [0, 1000]))
        throw new RangeError(`Invalid reference value for ${kind}`);
  }
}

/** Validate an imported config, rebuilding it from known fields only. */
export function parseAoiConfig(value: unknown): AoiConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RangeError("AOI config must be an object");
  const r = value as Record<string, unknown>;
  const pick = <T>(key: string): T => {
    if (!Object.hasOwn(r, key)) throw new RangeError(`Missing ${key}`);
    return r[key] as T;
  };
  const device = (d: unknown): AoiDevice => {
    const x = (d ?? {}) as Record<string, unknown>;
    return {
      id: x.id as string,
      name: x.name as string,
      tilt: x.tilt as number,
      azimuth: x.azimuth as number,
      distance: x.distance as number,
      fov: x.fov as number,
      aperture: x.aperture as number,
    };
  };
  const material = (m: unknown): SurfaceMaterial => {
    const x = (m ?? {}) as Record<string, unknown>;
    return {
      albedo: x.albedo as number,
      specular: x.specular as number,
      roughness: x.roughness as number,
    };
  };
  const materials = pick<Record<string, unknown>>("materials") ?? {};
  const references = pick<Record<string, unknown>>("references") ?? {};
  const result = {
    scene: pick("scene"),
    pcbRegion: pick("pcbRegion"),
    coding: pick("coding"),
    defocus: pick("defocus"),
    cameras: (pick<unknown[]>("cameras") ?? []).map(device),
    projectors: (pick<unknown[]>("projectors") ?? []).map(device),
    materials: Object.fromEntries(
      MATERIAL_SLOTS.map((slot) => [slot, material(materials[slot])]),
    ),
    references: Object.fromEntries(
      PAIR_CLASSES.map((kind) => {
        const x = (references[kind] ?? {}) as Record<string, unknown>;
        return [
          kind,
          {
            heightPer2Pi: (x.heightPer2Pi ?? null) as number | null,
            range: (x.range ?? null) as number | null,
            note: (x.note ?? "") as string,
          },
        ];
      }),
    ),
  } as Partial<AoiConfig>;
  for (const key of Object.keys(AOI_LIMITS) as (keyof typeof AOI_LIMITS)[])
    (result as Record<string, unknown>)[key] = pick(key);
  if (!Array.isArray(r.cameras) || !Array.isArray(r.projectors))
    throw new RangeError("cameras and projectors must be arrays");
  validateAoiConfig(result as AoiConfig);
  return result as AoiConfig;
}

const RAD = Math.PI / 180;
export const AIM_POINT: Vec3 = [0, 0, 0];

/** Unit board-plane direction for an azimuth (x = world X, y = world Z). */
export const azimuthVector = (azimuth: number): Vec3 => [
  Math.cos(azimuth * RAD),
  0,
  Math.sin(azimuth * RAD),
];

export function devicePosition(device: AoiDevice): Vec3 {
  const t = device.tilt * RAD,
    a = device.azimuth * RAD;
  return [
    device.distance * Math.sin(t) * Math.cos(a),
    device.distance * Math.cos(t),
    device.distance * Math.sin(t) * Math.sin(a),
  ];
}

/** Camera image right is tangential (⊥ azimuth); straight-down cameras use +x. */
export function cameraPinhole(device: AoiDevice, width: number): Pinhole {
  const a = device.azimuth * RAD;
  const hint: Vec3 =
    device.tilt < 1e-6 ? [1, 0, 0] : [-Math.sin(a), 0, Math.cos(a)];
  return makePinhole(
    devicePosition(device),
    AIM_POINT,
    width,
    (width * 3) / 4,
    device.fov,
    hint,
  );
}

/**
 * Projector columns run along its azimuth plane, so fringes are perpendicular
 * to the azimuth and the projector's own tilt produces the height sensitivity.
 * A projector straight overhead has no azimuth plane; its fringes vary along +x.
 */
export function projectorPinhole(device: AoiDevice, width: number): Pinhole {
  const hint: Vec3 =
    device.tilt < 1e-6 ? [1, 0, 0] : azimuthVector(device.azimuth);
  return makePinhole(
    devicePosition(device),
    AIM_POINT,
    width,
    (width * 3) / 4,
    device.fov,
    hint,
  );
}

export interface PairInfo {
  id: string;
  cameraId: string;
  projectorId: string;
  cameraIndex: number;
  projectorIndex: number;
  kind: PairClass;
  /** |Δazimuth| folded into [0°, 180°]. */
  deltaAzimuth: number;
  cameraTilt: number;
  projectorTilt: number;
}

export const foldAzimuth = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/** Class from geometry only: never from a fixed device count. */
export function classifyPair(
  camera: AoiDevice,
  projector: AoiDevice,
  directTiltLimit: number,
): PairClass {
  if (camera.tilt <= directTiltLimit) return "direct";
  const delta = foldAzimuth(camera.azimuth, projector.azimuth);
  return delta <= 45 ? "same" : delta >= 135 ? "opposite" : "orthogonal";
}

export function enumeratePairs(config: AoiConfig): PairInfo[] {
  const pairs: PairInfo[] = [];
  config.cameras.forEach((camera, cameraIndex) =>
    config.projectors.forEach((projector, projectorIndex) =>
      pairs.push({
        id: `${camera.id}-${projector.id}`,
        cameraId: camera.id,
        projectorId: projector.id,
        cameraIndex,
        projectorIndex,
        kind: classifyPair(camera, projector, config.directTiltLimit),
        deltaAzimuth: foldAzimuth(camera.azimuth, projector.azimuth),
        cameraTilt: camera.tilt,
        projectorTilt: projector.tilt,
      }),
    ),
  );
  return pairs;
}

export interface GridSpec {
  nx: number;
  ny: number;
  cellSize: number;
  /** Board x/y of the lower corner of cell (0, 0). */
  x0: number;
  y0: number;
}
/** Unified board-plane grid shared by every pair, truth and fusion. */
export function makeGrid(config: AoiConfig): GridSpec {
  const nx = Math.max(1, Math.round(config.roiWidth / config.cellSize)),
    ny = Math.max(1, Math.round(config.roiHeight / config.cellSize));
  return {
    nx,
    ny,
    cellSize: config.cellSize,
    x0: (-nx * config.cellSize) / 2,
    y0: (-ny * config.cellSize) / 2,
  };
}
export const cellCenter = (grid: GridSpec, cell: number): [number, number] => [
  grid.x0 + ((cell % grid.nx) + 0.5) * grid.cellSize,
  grid.y0 + (Math.floor(cell / grid.nx) + 0.5) * grid.cellSize,
];
export function cellOf(grid: GridSpec, x: number, y: number): number {
  const ix = Math.floor((x - grid.x0) / grid.cellSize),
    iy = Math.floor((y - grid.y0) / grid.cellSize);
  return ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny
    ? -1
    : iy * grid.nx + ix;
}

/** Patterns per pair: N fine, then N coarse (dual: p₂ = p₁·ratio; temporal: one period). */
export function aoiPatterns(
  config: Pick<
    AoiConfig,
    "phaseSteps" | "fringeFrequency" | "coding" | "periodRatio"
  >,
): { frequency: number; shift: number }[] {
  const n = config.phaseSteps;
  const set = (frequency: number) =>
    Array.from({ length: n }, (_, k) => ({
      frequency,
      shift: (2 * Math.PI * k) / n,
    }));
  if (config.coding === "single") return set(config.fringeFrequency);
  return [
    ...set(config.fringeFrequency),
    ...set(
      config.coding === "dual"
        ? config.fringeFrequency / config.periodRatio
        : 1,
    ),
  ];
}
