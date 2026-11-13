import { describe, expect, it } from "vitest";
import { TAU } from "../core/simulation";
import type { Vec3 } from "../sandbox/geometry";
import { buildTraceScene } from "../sandbox/lightTransport";
import {
  captureWorld,
  createWorld,
  DEFAULT_WORLD,
  getRig,
  parseWorldConfig,
  pinholesFor,
  projectorPhase,
  validateWorldConfig,
  type WorldConfig,
} from "../sandbox/scanner";
import {
  classifyPair,
  foldAzimuth,
  fromSpherical,
  placePreset,
  RIG_PRESETS,
  spherical,
  type Device,
} from "../sandbox/devices";
import { blurDiameter, gaussianMtf, scatterBlur } from "../sandbox/optics";
import { enumeratePairs, makeGrid } from "./rig";
import {
  boardPeriod,
  codingRange,
  depthOfField,
  erfc,
  heightSensitivity,
  orderErrorProbability,
  pairTheory,
  parallelSensitivity,
} from "./sensitivity";
import { renderPair, traceCamera } from "./render";
import { binToGrid } from "./reconstruct";
import {
  consistencyMatrix,
  fuseDirectWithOblique,
  robustFuse,
  STATUS,
  type FusionSource,
} from "./fusion";
import {
  defaultFusionOptions,
  runAoi,
  runStrategies,
  scoreStrategy,
  theoryForAll,
} from "./simulate";
import { MEASURED_REASONS, REASON_INDEX } from "./evaluate";
import { aoiCsv, aoiJson } from "./export";

/** AOI rig placed around a board whose top (the reference plane) is 2 mm above the ground. */
const REF = 2;
const AOI = placePreset(RIG_PRESETS[0], [0, REF, 0]);
const MATTE: Partial<WorldConfig> = {
  objectAlbedo: 0.5,
  objectSpecular: 0,
  objectRoughness: 0.6,
  chipAlbedo: 0.7,
  chipSpecular: 0,
  chipRoughness: 0.5,
};
/** C0 straight down, C1 oblique at 0°, P2 at 180°: C0-P2 direct, C1-P2 opposite. */
const config = (patch: Partial<WorldConfig> = {}): WorldConfig => ({
  ...DEFAULT_WORLD,
  ...MATTE,
  shape: "plane",
  y: REF + 0.5,
  referenceHeight: REF,
  cameras: [AOI.cameras[0], AOI.cameras[1]],
  projectors: [AOI.projectors[2]],
  activeCamera: "C0",
  activeProjector: "P2",
  cameraWidth: 64,
  projectorWidth: 640,
  phaseSteps: 4,
  fringeFrequency: 16,
  coding: "single",
  fringeOffset: 0.45,
  fringeAmplitude: 0.4,
  minModulation: 0.015,
  noiseSigma: 0,
  defocus: false,
  seed: 7,
  cellSize: 0.3,
  ...patch,
});
const fullRig = (patch: Partial<WorldConfig> = {}) =>
  config({
    ...AOI,
    activeCamera: "C0",
    activeProjector: "P0",
    ...patch,
  });
const median = (values: ArrayLike<number>) => {
  const v = Array.from(values)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
};

describe("multi-view rig and pair classification", () => {
  it("derives 4 opposite, 8 orthogonal, 4 same-side and 4 direct pairs from the AOI preset geometry", () => {
    const pairs = enumeratePairs(fullRig());
    const count = (kind: string) => pairs.filter((p) => p.kind === kind).length;
    expect(pairs).toHaveLength(20);
    expect([
      count("opposite"),
      count("orthogonal"),
      count("same"),
      count("direct"),
    ]).toEqual([4, 8, 4, 4]);
  });

  it("classifies by azimuth difference and tilt, not by device count", () => {
    expect(foldAzimuth(350, 10)).toBeCloseTo(20);
    expect(foldAzimuth(-90, 90)).toBeCloseTo(180);
    expect(classifyPair(35, 0, 30, 10)).toBe("same");
    expect(classifyPair(35, 0, 100, 10)).toBe("orthogonal");
    expect(classifyPair(35, 0, 200, 10)).toBe("opposite");
    expect(classifyPair(5, 0, 200, 10)).toBe("direct");
    const aim: Vec3 = [0, REF, 0];
    const at = (id: string, azimuth: number, tilt: number): Device => ({
      id,
      name: id,
      ...fromSpherical(aim, tilt, azimuth, 110),
      fov: 8,
      aperture: 0,
    });
    const custom = config({
      cameras: [at("C0", 0, 35), at("C1", 120, 35)],
      projectors: [at("P0", 0, 30), at("P1", 100, 30), at("P2", 200, 30)],
      activeCamera: "C0",
      activeProjector: "P0",
    });
    expect(enumeratePairs(custom).map((p) => p.kind)).toEqual([
      "same",
      "orthogonal",
      "opposite",
      "orthogonal",
      "same",
      "orthogonal",
    ]);
  });

  it("round-trips device spherical coordinates and keeps the shared config valid", () => {
    const aim: Vec3 = [3, REF, -2];
    const s = spherical(fromSpherical(aim, 35, 270, 110), aim);
    expect(s.tilt).toBeCloseTo(35, 3);
    expect(s.azimuth).toBeCloseTo(270, 3);
    expect(s.distance).toBeCloseTo(110, 3);
    const c = fullRig();
    validateWorldConfig(c);
    expect(parseWorldConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(() =>
      validateWorldConfig({
        ...c,
        projectors: [c.projectors[0], c.projectors[0]],
      }),
    ).toThrow(/unique/);
  });
});

describe("phase sensitivity and measurement range", () => {
  const rig = (camera: Device, projector: Device, c = config()) =>
    pinholesFor(c, camera, projector, 192);

  it("matches a finite difference of the projector phase along the camera ray", () => {
    const { camera, projector } = rig(AOI.cameras[1], AOI.projectors[2]);
    for (const [x, y] of [
      [0, 0],
      [3, -2],
      [-2.5, 2.8],
    ]) {
      const point: Vec3 = [x, REF + 0.4, y];
      const ray = point.map((v, i) => v - camera.position[i]) as Vec3;
      const at = (h: number) =>
        projectorPhase(
          projector,
          16,
          ray.map(
            (r, i) =>
              camera.position[i] + (r * (h - camera.position[1])) / ray[1],
          ) as Vec3,
        )!;
      const numeric = (at(point[1] + 1e-4) - at(point[1] - 1e-4)) / 2e-4;
      expect(heightSensitivity(camera, projector, 16, point)).toBeCloseTo(
        numeric,
        3,
      );
    }
  });

  it("equals the far-field formula (2π/p)|tanθp − tanθc·cosΔα| at the aim point for every pair class", () => {
    const c = fullRig({ y: REF });
    for (const { pair } of theoryForAll(c)) {
      const { camera, projector } = pinholesFor(
        c,
        c.cameras[pair.cameraIndex],
        c.projectors[pair.projectorIndex],
      );
      const p = boardPeriod(projector, 16, [0, REF, 0]);
      expect(
        Math.abs(heightSensitivity(camera, projector, 16, [0, REF, 0])),
      ).toBeCloseTo(
        parallelSensitivity(
          pair.cameraTilt,
          pair.projectorTilt,
          pair.deltaAzimuth,
          p,
        ),
        6,
      );
    }
  });

  it("orders range per 2π: opposite < orthogonal ≈ direct < same side", () => {
    const theory = theoryForAll(fullRig());
    const mean = (kind: string) => {
      const list = theory.filter((t) => t.pair.kind === kind);
      return list.reduce((s, t) => s + t.theory.heightPer2Pi, 0) / list.length;
    };
    expect(mean("opposite")).toBeLessThan(mean("orthogonal"));
    expect(mean("orthogonal") / mean("direct")).toBeGreaterThan(0.85);
    expect(mean("orthogonal") / mean("direct")).toBeLessThan(1.15);
    expect(mean("same")).toBeGreaterThan(3 * mean("orthogonal"));
    for (const { theory: t } of theory)
      expect(t.heightPer2Pi * Math.abs(t.geometricSensitivity)).toBeCloseTo(
        TAU,
        9,
      );
  });

  it("extends the range by r/(r−1) for dual periods and trades it for order-error risk", () => {
    const base = { periodRatio: 1.25, fringeFrequency: 16 };
    expect(codingRange(1, { ...base, coding: "single" })).toBe(1);
    expect(codingRange(1, { ...base, coding: "dual" })).toBeCloseTo(5);
    expect(codingRange(1, { ...base, coding: "temporal" })).toBe(16);
    expect(
      codingRange(1.5, { ...base, coding: "coarse", periodRatio: 10 }),
    ).toBeCloseTo(15, 12);
    const coarseRisk = (r: number) =>
      orderErrorProbability(
        { coding: "coarse", periodRatio: r, fringeFrequency: 16 },
        0.02,
      );
    expect(coarseRisk(20)).toBeGreaterThan(coarseRisk(5));
    const risk = (r: number) =>
      orderErrorProbability(
        { coding: "dual", periodRatio: r, fringeFrequency: 16 },
        0.1,
      );
    expect(risk(1.1)).toBeGreaterThan(risk(1.5));
    expect(risk(1.5)).toBeGreaterThan(risk(3));
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1)).toBeCloseTo(0.1572992, 6);
  });

  it("puts the depth-of-field limits exactly where the blur circle reaches the criterion", () => {
    const c = config({ defocus: true });
    const device = AOI.cameras[1];
    const { camera } = pinholesFor(c, device, AOI.projectors[2]);
    const [lo, hi] = depthOfField(camera, device, c, 2);
    const depthAt = (h: number) =>
      [0, REF + h, 0].reduce(
        (s, v, i) => s + (v - camera.position[i]) * camera.forward[i],
        0,
      );
    const focus = depthAt(0);
    for (const h of [lo, hi])
      expect(
        blurDiameter(camera.fx, device.aperture, depthAt(h), focus),
      ).toBeCloseTo(2, 6);
    expect(depthOfField(camera, { ...device, aperture: 0 }, c, 2)).toEqual([
      -Infinity,
      Infinity,
    ]);
    expect(gaussianMtf(0, 10)).toBe(1);
    expect(gaussianMtf(10 / Math.PI, 10)).toBeCloseTo(Math.exp(-2), 9);
  });
});

describe("shared forward model and reconstruction", () => {
  it("renders exactly what the sandbox scan captures for the same pair", () => {
    const c = config({ noiseSigma: 0.004, defocus: true, focusHeight: 2 });
    const capture = captureWorld(c);
    const { camera, projector } = getRig(c);
    const world = createWorld(c);
    const scene = buildTraceScene(world.meshes);
    try {
      const frames = renderPair(
        scene,
        traceCamera(scene, camera, c.pixelGrid),
        camera,
        projector,
        c.cameras[0],
        c.projectors[0],
        c,
        c.seed,
      ).frames;
      frames.forEach((frame, k) =>
        frame.forEach((v, i) =>
          expect(v).toBeCloseTo(capture.frames[k][i], 12),
        ),
      );
    } finally {
      scene.dispose();
      world.dispose();
    }
  });

  it("recovers a flat plane inside the phase window for direct and oblique pairs", () => {
    const run = runAoi(config());
    for (const pair of run.pairs) {
      expect(pair.evaluation.coverage).toBeGreaterThan(0.8);
      expect(Math.abs(median(pair.map.height) - (REF + 0.5))).toBeLessThan(
        2e-3,
      );
    }
  });

  it("aliases by exactly one range when the plane is above the window (single period)", () => {
    const theory = theoryForAll(config()).find(
      (t) => t.pair.kind === "opposite",
    )!.theory;
    const height = DEFAULT_WORLD.windowBottom + 1.2 * theory.codingRange;
    const run = runAoi(config({ y: REF + height }), ["C1-P2"]);
    expect(median(run.pairs[0].map.height) - REF).toBeCloseTo(
      height - theory.codingRange,
      1,
    );
    expect(
      run.pairs[0].evaluation.reasonCounts[REASON_INDEX.rangeAlias],
    ).toBeGreaterThan(0);
    for (const coding of ["dual", "temporal", "coarse"] as const) {
      const other = runAoi(config({ y: REF + height, coding }), ["C1-P2"]);
      expect(
        Math.abs(median(other.pairs[0].map.height) - REF - height),
      ).toBeLessThan(2e-3);
    }
  });

  it("matches the theoretical modulation and height noise on the reference plane", () => {
    const quiet = config({ y: REF });
    const clean = runAoi(quiet, ["C0-P2"]).pairs[0];
    const { width, height, modulation } = clean.image;
    const centre = (height / 2) * width + width / 2;
    expect(modulation[centre] / clean.theory.modulation).toBeCloseTo(1, 2);
    const noisy = runAoi({ ...quiet, noiseSigma: 0.004 }, ["C0-P2"]).pairs[0];
    const ys: number[] = [];
    for (let i = 1; i < noisy.points.length; i += 3) ys.push(noisy.points[i]);
    const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
    const std = Math.sqrt(
      ys.reduce((s, v) => s + (v - mean) ** 2, 0) / ys.length,
    );
    expect(std / noisy.theory.sigmaHeight).toBeGreaterThan(0.8);
    expect(std / noisy.theory.sigmaHeight).toBeLessThan(1.25);
  });

  it("lowers projector-fringe contrast out of focus as the Gaussian MTF predicts", () => {
    const blurred = config({
      y: REF,
      defocus: true,
      focusHeight: 3,
      fringeFrequency: 64,
      cameras: [{ ...AOI.cameras[0], aperture: 0 }],
      projectors: [{ ...AOI.projectors[2], aperture: 12 }],
    });
    const sharp = { ...blurred, defocus: false };
    const centre = (run: ReturnType<typeof runAoi>) => {
      const { width, height, modulation } = run.pairs[0].image;
      return modulation[(height / 2) * width + width / 2];
    };
    const ratio = centre(runAoi(blurred)) / centre(runAoi(sharp));
    const predicted =
      theoryForAll(blurred)[0].theory.modulation /
      theoryForAll(sharp)[0].theory.modulation;
    expect(ratio).toBeLessThan(0.8);
    expect(Math.abs(ratio / predicted - 1)).toBeLessThan(0.05);
  });

  it("is reproducible for a fixed seed and changes with the seed", () => {
    const noisy = config({ noiseSigma: 0.004 });
    const a = runAoi(noisy, ["C0-P2"]).pairs[0].map.height,
      b = runAoi(noisy, ["C0-P2"]).pairs[0].map.height,
      c = runAoi({ ...noisy, seed: 8 }, ["C0-P2"]).pairs[0].map.height;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("bins with the median so a single outlier pixel cannot move a cell", () => {
    const grid = makeGrid(config({ roiWidth: 1, roiHeight: 1, cellSize: 1 }));
    const points = new Float64Array([0, 1, 0, 0.1, 1.01, 0.1, -0.1, 9, -0.1]);
    const map = binToGrid(
      {
        valid: new Uint8Array([1, 1, 1]),
        points,
        sigmaHeight: new Float64Array(3).fill(0.01),
      },
      grid,
    );
    expect(map.height[0]).toBeCloseTo(1.01);
    expect(map.count[0]).toBe(3);
  });

  it("keeps energy and leaves σ = 0 pixels untouched in the defocus blur", () => {
    const image = new Float64Array(400);
    image[210] = 1;
    const [same] = scatterBlur([image], 20, 20, new Float64Array(400));
    expect(Array.from(same)).toEqual(Array.from(image));
    const [spread] = scatterBlur(
      [image],
      20,
      20,
      new Float64Array(400).fill(1.5),
    );
    expect(spread.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(spread[210]).toBeLessThan(0.2);
  });
});

describe("evaluation, failure reasons and fusion", () => {
  it("explains every cell and finds occlusion and shadow around a tall part", () => {
    const run = runAoi(
      config({ shape: "chip", y: REF, cellSize: 0.2, cameraWidth: 96 }),
    );
    for (const p of run.pairs) {
      const e = p.evaluation;
      expect(e.reasonCounts.reduce((s, n) => s + n, 0)).toBe(
        run.grid.nx * run.grid.ny,
      );
      expect(
        e.reasonCounts.slice(0, MEASURED_REASONS).reduce((s, n) => s + n, 0),
      ).toBe(e.measuredCells);
    }
    const counts = (key: keyof typeof REASON_INDEX) =>
      run.pairs.reduce(
        (s, p) => s + p.evaluation.reasonCounts[REASON_INDEX[key]],
        0,
      );
    expect(counts("shadow")).toBeGreaterThan(0);
    expect(counts("cameraOccluded")).toBeGreaterThan(0);
  });

  it("rejects an inconsistent pair and reports the conflict without truth", () => {
    const source = (id: string, values: number[]): FusionSource => ({
      id,
      kind: "opposite",
      height: Float64Array.from(values),
      sigma: new Float64Array(values.length).fill(0.01),
    });
    const a = source("a", [1, NaN, NaN]),
      b = source("b", [1.01, NaN, NaN]),
      c = source("c", [3, 2, NaN]);
    const fused = robustFuse([a, b, c], 0.05);
    expect(fused.height[0]).toBeCloseTo(1.005, 6);
    expect(fused.status[0]).toBe(STATUS.conflict);
    expect(fused.support[0]).toBe(2);
    expect(fused.spread[0]).toBeCloseTo(2);
    expect(fused.status[1]).toBe(STATUS.single);
    expect(fused.status[2]).toBe(STATUS.none);
    const direct = source("d", [NaN, 2.5, NaN]);
    const filled = fuseDirectWithOblique([direct], [a, b], 0.05);
    expect([filled.origin[0], filled.origin[1], filled.origin[2]]).toEqual([
      1, 0, 255,
    ]);
    const matrix = consistencyMatrix([a, b, c], 0.05);
    expect(matrix.find((m) => m.a === "a" && m.b === "b")!.rms).toBeCloseTo(
      0.01,
    );
    expect(matrix.find((m) => m.a === "a" && m.b === "c")!.conflictRatio).toBe(
      1,
    );
  });

  it("fills direct-view holes from oblique pairs on a real scene", () => {
    const c = fullRig({
      shape: "step",
      y: REF,
      cellSize: 0.2,
      cameraWidth: 96,
      projectors: [AOI.projectors[0], AOI.projectors[2]],
    });
    const run = runAoi(c);
    const all = defaultFusionOptions(run.pairs.map((p) => p.pair));
    // One direct pair keeps that projector's shadows as holes to be filled.
    const options = { ...all, direct: [all.direct[0]] };
    const { strategies } = runStrategies(
      run.pairs,
      options,
      c.consistencyTolerance,
    );
    const score = (id: string) =>
      scoreStrategy(
        strategies.find((s) => s.id === id)!,
        run.pairs,
        run.truth,
        c.tolerance,
      );
    const directOnly = runStrategies(
      run.pairs,
      { ...options, oblique: [] },
      c.consistencyTolerance,
    );
    const directScore = scoreStrategy(
      directOnly.strategies[0],
      run.pairs,
      run.truth,
      c.tolerance,
    );
    expect(score("directOblique").coverage).toBeGreaterThan(
      directScore.coverage,
    );
    expect(strategies.map((s) => s.id)).toEqual([
      "directOblique",
      "single",
      "oblique",
    ]);
  });

  it("keeps theory independent of the scene and of AOI reference values", () => {
    const base = fullRig();
    const other = {
      ...base,
      shape: "chip" as const,
      references: {
        ...base.references,
        opposite: {
          heightPer2Pi: 0.42,
          range: 0.5,
          sensitivityRatio: 3,
          noiseRatio: 0.3,
          note: "vendor sheet",
        },
      },
    };
    const pair = enumeratePairs(base)[5];
    const pins = pinholesFor(
      base,
      base.cameras[pair.cameraIndex],
      base.projectors[pair.projectorIndex],
    );
    expect(pairTheory(base, pair, pins.camera, pins.projector)).toEqual(
      pairTheory(other, pair, pins.camera, pins.projector),
    );
  });

  it("exports per-cell CSV relative to the reference plane and a summary JSON with the disclaimer", () => {
    const c = config({ cameras: [AOI.cameras[0]] });
    const run = runAoi(c);
    const { strategies, consistency } = runStrategies(
      run.pairs,
      defaultFusionOptions(run.pairs.map((p) => p.pair)),
      c.consistencyTolerance,
    );
    const csv = aoiCsv(run, c, strategies).split("\r\n");
    expect(csv[0]).toMatch(/NOT Micro Phase Shifting/);
    const header = csv
      .find((line) => line.startsWith("board_x_mm"))!
      .split(",");
    expect(header).toContain("h_C0-P2_mm");
    expect(header).toContain("reason_C0-P2");
    const rows = csv.filter((l) => /^-?\d/.test(l));
    expect(rows).toHaveLength(run.grid.nx * run.grid.ny);
    expect(Number(rows[0].split(",")[2])).toBeCloseTo(0.5, 6);
    const json = JSON.parse(
      aoiJson({
        config: c,
        theory: theoryForAll(c),
        run,
        strategies: strategies.map((result) => ({
          result,
          score: scoreStrategy(result, run.pairs, run.truth, c.tolerance),
        })),
        consistency,
        sweep: [],
      }),
    );
    expect(json.disclaimer).toMatch(/not AOI machine performance/);
    expect(json.simulation.pairs[0].pair).toBe("C0-P2");
    expect(json.theory[0].window[1]).toBeGreaterThan(json.theory[0].window[0]);
  });
});
