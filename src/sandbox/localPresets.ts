import {
  emptyReferences,
  rigTarget,
  type ClassReference,
  type WorldConfig,
} from "./scanner";
import {
  fromSpherical,
  PAIR_CLASSES,
  type Device,
  type PairClass,
} from "./devices";

interface SphericalDevice {
  name: string;
  tilt: number;
  azimuth: number;
  distance: number;
  fov: number;
  aperture: number;
}

/** A machine-specific setup kept outside version control (src/local/*.preset.json). */
export interface LocalPreset {
  id: string;
  name: string;
  description?: string;
  /** Scene, coding and analysis fields applied before the devices are placed. */
  config?: Partial<WorldConfig>;
  cameras: SphericalDevice[];
  projectors: SphericalDevice[];
  references?: Partial<Record<PairClass, Partial<ClassReference>>>;
}

// src/local/ is git-ignored, so confidential presets never leave this machine; an empty folder yields [].
const modules = import.meta.glob<LocalPreset>("../local/*.preset.json", {
  eager: true,
  import: "default",
});
export const LOCAL_PRESETS: LocalPreset[] = Object.values(modules);

export function applyLocalPreset(
  preset: LocalPreset,
  current: WorldConfig,
): WorldConfig {
  const base = { ...current, ...preset.config };
  const aim = rigTarget(base);
  const place = (prefix: string, list: SphericalDevice[]): Device[] =>
    list.map((d, i) => ({
      id: `${prefix}${i}`,
      name: d.name,
      ...fromSpherical(aim, d.tilt, d.azimuth, d.distance),
      fov: d.fov,
      aperture: d.aperture,
    }));
  const cameras = place("C", preset.cameras),
    projectors = place("P", preset.projectors);
  const references = emptyReferences();
  for (const kind of PAIR_CLASSES)
    Object.assign(references[kind], preset.references?.[kind]);
  return {
    ...base,
    cameras,
    projectors,
    activeCamera: cameras[0].id,
    activeProjector: projectors[0].id,
    references,
  };
}
