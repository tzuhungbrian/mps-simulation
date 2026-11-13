import { describe, expect, it } from "vitest";
import {
  applyLocalPreset,
  LOCAL_PRESETS,
  type LocalPreset,
} from "./localPresets";
import { DEFAULT_WORLD, rigTarget, validateWorldConfig } from "./scanner";
import { spherical } from "./devices";

const SAMPLE: LocalPreset = {
  id: "sample",
  name: "sample",
  config: {
    shape: "plane",
    y: 2,
    referenceHeight: 2,
    coding: "coarse",
    periodRatio: 6,
  },
  cameras: [
    { name: "top", tilt: 0, azimuth: 0, distance: 100, fov: 8, aperture: 0 },
    { name: "side", tilt: 40, azimuth: 90, distance: 100, fov: 8, aperture: 0 },
  ],
  projectors: [
    { name: "p", tilt: 30, azimuth: 180, distance: 110, fov: 6, aperture: 0 },
  ],
  references: { opposite: { heightPer2Pi: 0.5, sensitivityRatio: 2 } },
};

describe("local presets", () => {
  it("places devices around the aim point and fills the references", () => {
    const config = applyLocalPreset(SAMPLE, DEFAULT_WORLD);
    expect(() => validateWorldConfig(config)).not.toThrow();
    expect(config.coding).toBe("coarse");
    expect(config.cameras.map((c) => c.id)).toEqual(["C0", "C1"]);
    expect(config.activeProjector).toBe("P0");
    const aim = rigTarget(config);
    const side = spherical(config.cameras[1], aim);
    expect(side.tilt).toBeCloseTo(40, 3);
    expect(side.distance).toBeCloseTo(100, 3);
    expect(config.references.opposite.heightPer2Pi).toBe(0.5);
    expect(config.references.opposite.range).toBeNull();
    expect(config.references.direct.heightPer2Pi).toBeNull();
  });

  it("only yields valid configurations from whatever presets exist on this machine", () => {
    for (const preset of LOCAL_PRESETS)
      expect(() =>
        validateWorldConfig(applyLocalPreset(preset, DEFAULT_WORLD)),
      ).not.toThrow();
  });
});
