import { makePinhole, type Pinhole, type Vec3 } from "./geometry";

/** A camera or projector at an absolute world position (mm); it always looks at the rig aim point. */
export interface Device {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
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

const RAD = Math.PI / 180;
export const devicePosition = (d: Pick<Device, "x" | "y" | "z">): Vec3 => [
  d.x,
  d.y,
  d.z,
];

/**
 * Tilt from the vertical, azimuth in the board plane (from +x toward +z) and
 * distance, all measured from the aim point.
 */
export function spherical(
  d: Pick<Device, "x" | "y" | "z">,
  aim: Vec3,
): { tilt: number; azimuth: number; distance: number } {
  const dx = d.x - aim[0],
    dy = d.y - aim[1],
    dz = d.z - aim[2];
  const distance = Math.hypot(dx, dy, dz);
  const horizontal = Math.hypot(dx, dz);
  return {
    distance,
    tilt: Math.atan2(horizontal, dy) / RAD,
    azimuth: horizontal < 1e-9 ? 0 : (Math.atan2(dz, dx) / RAD + 360) % 360,
  };
}

export function fromSpherical(
  aim: Vec3,
  tilt: number,
  azimuth: number,
  distance: number,
): Pick<Device, "x" | "y" | "z"> {
  const t = tilt * RAD,
    a = azimuth * RAD;
  // Rounded to 1 µm so presets and edits produce stable, readable values.
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return {
    x: r(aim[0] + distance * Math.sin(t) * Math.cos(a)),
    y: r(aim[1] + distance * Math.cos(t)),
    z: r(aim[2] + distance * Math.sin(t) * Math.sin(a)),
  };
}

/** Camera image right is tangential to its azimuth; straight-down cameras use +x. */
export function cameraPinhole(
  device: Device,
  aim: Vec3,
  width: number,
  height = (width * 3) / 4,
): Pinhole {
  const p = devicePosition(device);
  const dx = p[0] - aim[0],
    dz = p[2] - aim[2],
    horizontal = Math.hypot(dx, dz);
  const hint: Vec3 =
    horizontal < 1e-9 * Math.max(1, Math.abs(p[1] - aim[1]))
      ? [1, 0, 0]
      : [-dz / horizontal, 0, dx / horizontal];
  return makePinhole(p, aim, width, height, device.fov, hint);
}

/**
 * Projector columns run in its vertical plane, so fringes are perpendicular to
 * its azimuth and its own tilt produces height sensitivity regardless of which
 * camera is paired with it. A projector straight overhead varies along +x.
 */
export function projectorPinhole(
  device: Device,
  aim: Vec3,
  width: number,
): Pinhole {
  const p = devicePosition(device);
  const horizontal = Math.hypot(p[0] - aim[0], p[2] - aim[2]);
  const hint: Vec3 =
    horizontal < 1e-9 * Math.max(1, Math.abs(p[1] - aim[1]))
      ? [1, 0, 0]
      : [0, -1, 0];
  return makePinhole(p, aim, width, (width * 3) / 4, device.fov, hint);
}

export const foldAzimuth = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/** Class from geometry only, never from a fixed device count. */
export function classifyPair(
  cameraTilt: number,
  cameraAzimuth: number,
  projectorAzimuth: number,
  directTiltLimit: number,
): PairClass {
  if (cameraTilt <= directTiltLimit) return "direct";
  const delta = foldAzimuth(cameraAzimuth, projectorAzimuth);
  return delta <= 45 ? "same" : delta >= 135 ? "opposite" : "orthogonal";
}

export interface RigPreset {
  id: string;
  name: string;
  cameras: {
    name: string;
    tilt: number;
    azimuth: number;
    distance: number;
    fov: number;
    aperture: number;
  }[];
  projectors: {
    name: string;
    tilt: number;
    azimuth: number;
    distance: number;
    fov: number;
    aperture: number;
  }[];
}

const ring = (
  label: string,
  tilt: number,
  distance: number,
  fov: number,
  aperture: number,
  azimuths = [0, 90, 180, 270],
) =>
  azimuths.map((azimuth) => ({
    name: `${label} ${azimuth}°`,
    tilt,
    azimuth,
    distance,
    fov,
    aperture,
  }));

/** Typical AOI layout: one direct camera, four oblique cameras and four projectors on a common ring. */
export const RIG_PRESETS: RigPreset[] = [
  {
    id: "aoi",
    name: "AOI：1 直視 + 4 斜視 Camera × 4 Projector",
    cameras: [
      {
        name: "直視 Camera",
        tilt: 0,
        azimuth: 0,
        distance: 110,
        fov: 6,
        aperture: 4,
      },
      ...ring("斜視 Camera", 35, 110, 7.5, 4),
    ],
    projectors: ring("Projector", 30, 120, 8, 3),
  },
  {
    id: "aoi-oblique",
    name: "AOI：4 斜視 Camera × 4 Projector（16 組斜視）",
    cameras: ring("斜視 Camera", 35, 110, 7.5, 4),
    projectors: ring("Projector", 30, 120, 8, 3),
  },
  {
    id: "aoi-two-projectors",
    name: "AOI：1 直視 + 4 斜視 × 2 Projector",
    cameras: [
      {
        name: "直視 Camera",
        tilt: 0,
        azimuth: 0,
        distance: 110,
        fov: 6,
        aperture: 4,
      },
      ...ring("斜視 Camera", 35, 110, 7.5, 4),
    ],
    projectors: ring("Projector", 30, 120, 8, 3, [0, 180]),
  },
];

/** Place a preset around the aim point with ids C0…, P0…; the first camera / projector become active. */
export function placePreset(
  preset: RigPreset,
  aim: Vec3,
): { cameras: Device[]; projectors: Device[] } {
  const place = (prefix: string, list: RigPreset["cameras"]): Device[] =>
    list.map((d, i) => ({
      id: `${prefix}${i}`,
      name: d.name,
      ...fromSpherical(aim, d.tilt, d.azimuth, d.distance),
      fov: d.fov,
      aperture: d.aperture,
    }));
  return {
    cameras: place("C", preset.cameras),
    projectors: place("P", preset.projectors),
  };
}
