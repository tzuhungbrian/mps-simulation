import { describe, expect, it } from "vitest";
import { TAU } from "../core/simulation";
import { cameraRay, type Vec3 } from "../sandbox/geometry";
import {
  aoiPatterns,
  cameraPinhole,
  classifyPair,
  DEFAULT_AOI,
  DEFAULT_CAMERAS,
  DEFAULT_PROJECTORS,
  enumeratePairs,
  foldAzimuth,
  makeGrid,
  parseAoiConfig,
  projectorPinhole,
  validateAoiConfig,
  type AoiConfig,
  type AoiDevice,
} from "./rig";
import {
  blurDiameter,
  boardPeriod,
  codingRange,
  depthOfField,
  erfc,
  gaussianMtf,
  heightSensitivity,
  orderErrorProbability,
  pairTheory,
  parallelSensitivity,
  projectorPhase,
} from "./sensitivity";
import { scatterBlur } from "./render";
import { binToGrid, reconstructPair, codingOf } from "./reconstruct";
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

const config = (patch: Partial<AoiConfig> = {}): AoiConfig => ({
  ...DEFAULT_AOI,
  scene: "plane",
  planeHeight: 0.5,
  noiseSigma: 0,
  defocus: false,
  cameraWidth: 64,
  cellSize: 0.3,
  cameras: [DEFAULT_CAMERAS[0], DEFAULT_CAMERAS[1]],
  projectors: [DEFAULT_PROJECTORS[2]],
  ...patch,
});
const median = (values: ArrayLike<number>) => {
  const v = Array.from(values)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
};

describe("AOI rig and pair classification", () => {
  it("derives 4 opposite, 8 orthogonal, 4 same-side and 4 direct pairs from the default geometry", () => {
    const pairs = enumeratePairs(DEFAULT_AOI);
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
    const device = (azimuth: number, tilt = 35): AoiDevice => ({
      ...DEFAULT_CAMERAS[1],
      azimuth,
      tilt,
    });
    expect(foldAzimuth(350, 10)).toBeCloseTo(20);
    expect(foldAzimuth(-90, 90)).toBeCloseTo(180);
    expect(classifyPair(device(0), device(30), 10)).toBe("same");
    expect(classifyPair(device(0), device(100), 10)).toBe("orthogonal");
    expect(classifyPair(device(0), device(200), 10)).toBe("opposite");
    expect(classifyPair(device(0, 5), device(200), 10)).toBe("direct");
    const custom = {
      ...DEFAULT_AOI,
      cameras: [device(0), device(120)].map((d, i) => ({ ...d, id: `C${i}` })),
      projectors: [0, 100, 200].map((a, i) => ({
        ...DEFAULT_PROJECTORS[0],
        id: `P${i}`,
        azimuth: a,
      })),
    };
    expect(enumeratePairs(custom).map((p) => p.kind)).toEqual([
      "same",
      "orthogonal",
      "opposite",
      "orthogonal",
      "same",
      "orthogonal",
    ]);
  });

  it("validates and round-trips configs, rejecting unknown or out-of-range values", () => {
    validateAoiConfig(DEFAULT_AOI);
    expect(parseAoiConfig(JSON.parse(JSON.stringify(DEFAULT_AOI)))).toEqual(
      DEFAULT_AOI,
    );
    expect(() =>
      validateAoiConfig({ ...DEFAULT_AOI, periodRatio: 1 }),
    ).toThrow();
    expect(() => validateAoiConfig({ ...DEFAULT_AOI, cameras: [] })).toThrow();
    expect(() =>
      validateAoiConfig({
        ...DEFAULT_AOI,
        projectors: [DEFAULT_PROJECTORS[0], DEFAULT_PROJECTORS[0]],
      }),
    ).toThrow(/unique/);
  });

  it("orders fine patterns first, then the coarse set", () => {
    const p = aoiPatterns({
      phaseSteps: 4,
      fringeFrequency: 20,
      coding: "dual",
      periodRatio: 1.25,
    });
    expect(p.map((x) => x.frequency)).toEqual([20, 20, 20, 20, 16, 16, 16, 16]);
    expect(
      aoiPatterns({ ...DEFAULT_AOI, coding: "temporal" }).at(-1)!.frequency,
    ).toBe(1);
  });
});

describe("phase sensitivity and measurement range", () => {
  const rig = (camera: AoiDevice, projector: AoiDevice) => ({
    camera: cameraPinhole(camera, 192),
    projector: projectorPinhole(projector, 640),
  });

  it("matches a finite difference of the projector phase along the camera ray", () => {
    const { camera, projector } = rig(
      DEFAULT_CAMERAS[1],
      DEFAULT_PROJECTORS[2],
    );
    for (const [x, y] of [
      [0, 0],
      [3, -2],
      [-2.5, 2.8],
    ]) {
      const point: Vec3 = [x, 0.4, y];
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
      const numeric = (at(0.4 + 1e-4) - at(0.4 - 1e-4)) / 2e-4;
      expect(heightSensitivity(camera, projector, 16, point)).toBeCloseTo(
        numeric,
        3,
      );
    }
  });

  it("approaches the far-field formula (2π/p)|tanθp − tanθc·cosΔα| for every pair class", () => {
    const far = (d: AoiDevice): AoiDevice => ({
      ...d,
      distance: 1e5,
      fov: 0.01,
    });
    for (const [camera, projector] of [
      [DEFAULT_CAMERAS[0], DEFAULT_PROJECTORS[0]],
      [DEFAULT_CAMERAS[1], DEFAULT_PROJECTORS[2]],
      [DEFAULT_CAMERAS[1], DEFAULT_PROJECTORS[1]],
      [DEFAULT_CAMERAS[1], { ...DEFAULT_PROJECTORS[0], tilt: 50 }],
    ] as const) {
      const r = rig(far(camera), far(projector));
      const p = boardPeriod(r.projector, 16, [0, 0, 0]);
      const expected = parallelSensitivity(
        camera.tilt,
        projector.tilt,
        foldAzimuth(camera.azimuth, projector.azimuth),
        p,
      );
      expect(
        Math.abs(heightSensitivity(r.camera, r.projector, 16, [0, 0, 0])),
      ).toBeCloseTo(expected, 6);
    }
    // Same side with equal tilts: rays are parallel, no triangulation at all.
    const same = rig(
      far({ ...DEFAULT_CAMERAS[1], tilt: 30 }),
      far(DEFAULT_PROJECTORS[0]),
    );
    expect(
      Math.abs(heightSensitivity(same.camera, same.projector, 16, [0, 0, 0])),
    ).toBeLessThan(1e-6);
  });

  it("orders range per 2π: opposite < orthogonal ≈ direct < same side", () => {
    const theory = theoryForAll(DEFAULT_AOI);
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
    expect(
      codingRange(1, {
        coding: "single",
        periodRatio: 1.25,
        fringeFrequency: 16,
      }),
    ).toBe(1);
    expect(
      codingRange(1, {
        coding: "dual",
        periodRatio: 1.25,
        fringeFrequency: 16,
      }),
    ).toBeCloseTo(5);
    expect(
      codingRange(1, {
        coding: "temporal",
        periodRatio: 1.25,
        fringeFrequency: 16,
      }),
    ).toBe(16);
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
    const device = DEFAULT_CAMERAS[1],
      fx = cameraPinhole(device, 192).fx;
    const [lo, hi] = depthOfField(device, fx, 0, 2);
    const cos = Math.cos((device.tilt * Math.PI) / 180);
    for (const h of [lo, hi])
      expect(
        blurDiameter(
          fx,
          device.aperture,
          device.distance - h * cos,
          device.distance,
        ),
      ).toBeCloseTo(2, 6);
    expect(depthOfField({ ...device, aperture: 0 }, fx, 0, 2)).toEqual([
      -Infinity,
      Infinity,
    ]);
    expect(gaussianMtf(0, 10)).toBe(1);
    expect(gaussianMtf(10 / Math.PI, 10)).toBeCloseTo(Math.exp(-2), 9);
  });
});

describe("forward model and reconstruction", () => {
  it("recovers a flat plane inside the phase window for direct and oblique pairs", () => {
    const run = runAoi(config());
    for (const pair of run.pairs) {
      expect(pair.evaluation.coverage).toBeGreaterThan(0.8);
      expect(Math.abs(median(pair.map.height) - 0.5)).toBeLessThan(2e-3);
    }
  });

  it("aliases by exactly one range when the plane is above the window (single period)", () => {
    const theory = theoryForAll(config()).find(
      (t) => t.pair.kind === "opposite",
    )!.theory;
    const height = DEFAULT_AOI.windowBottom + 1.2 * theory.codingRange;
    const run = runAoi(config({ planeHeight: height }), ["C1-P3"]);
    const measured = median(run.pairs[0].map.height);
    expect(measured).toBeCloseTo(height - theory.codingRange, 1);
    expect(
      run.pairs[0].evaluation.reasonCounts[REASON_INDEX.rangeAlias],
    ).toBeGreaterThan(0);
    // Dual periods extend the window and recover the same plane.
    const dual = runAoi(config({ planeHeight: height, coding: "dual" }), [
      "C1-P3",
    ]);
    expect(Math.abs(median(dual.pairs[0].map.height) - height)).toBeLessThan(
      2e-3,
    );
    const temporal = runAoi(
      config({ planeHeight: height, coding: "temporal" }),
      ["C1-P3"],
    );
    expect(
      Math.abs(median(temporal.pairs[0].map.height) - height),
    ).toBeLessThan(2e-3);
  });

  it("matches the theoretical modulation and height noise on the reference plane", () => {
    const quiet = config({ planeHeight: 0 });
    const clean = runAoi(quiet, ["C0-P3"]).pairs[0];
    const { width, height, modulation } = clean.image;
    const centre = (height / 2) * width + width / 2;
    expect(modulation[centre] / clean.theory.modulation).toBeCloseTo(1, 2);
    const noisy = runAoi({ ...quiet, noiseSigma: 0.004 }, ["C0-P3"]).pairs[0];
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
      planeHeight: 0,
      defocus: true,
      focusHeight: 3,
      fringeFrequency: 64,
      cameras: [{ ...DEFAULT_CAMERAS[0], aperture: 0 }],
      projectors: [{ ...DEFAULT_PROJECTORS[2], aperture: 12 }],
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

  it("rejects captures that do not match the coding", () => {
    const c = config();
    const camera = cameraPinhole(c.cameras[0], c.cameraWidth),
      projector = projectorPinhole(c.projectors[0], c.projectorWidth);
    const count = camera.width * camera.height;
    expect(() =>
      reconstructPair(
        {
          width: camera.width,
          height: camera.height,
          frames: [new Float64Array(count)],
          clipped: new Uint8Array(count),
        },
        camera,
        projector,
        codingOf(c),
      ),
    ).toThrow(RangeError);
    expect(cameraRay(camera, camera.cx, camera.cy)[1]).toBeLessThan(-0.999);
  });

  it("is reproducible for a fixed seed and changes with the seed", () => {
    const noisy = config({ noiseSigma: 0.004 });
    const a = runAoi(noisy, ["C0-P3"]).pairs[0].map.height,
      b = runAoi(noisy, ["C0-P3"]).pairs[0].map.height,
      c = runAoi({ ...noisy, seed: 8 }, ["C0-P3"]).pairs[0].map.height;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("bins with the median so a single outlier pixel cannot move a cell", () => {
    const grid = makeGrid({
      ...DEFAULT_AOI,
      roiWidth: 1,
      roiHeight: 1,
      cellSize: 1,
    });
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
      config({
        scene: "chip",
        materials: DEFAULT_AOI.materials,
        cellSize: 0.2,
        cameraWidth: 96,
      }),
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
    const c = config({
      scene: "step",
      cellSize: 0.2,
      cameraWidth: 96,
      cameras: DEFAULT_CAMERAS,
      projectors: [DEFAULT_PROJECTORS[0], DEFAULT_PROJECTORS[2]],
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

  it("exposes theory that depends only on calibration", () => {
    const withReference = {
      ...DEFAULT_AOI,
      scene: "chip" as const,
      references: {
        ...DEFAULT_AOI.references,
        opposite: { heightPer2Pi: 0.42, range: 0.5, note: "vendor sheet" },
      },
    };
    const a = pairTheory(
      DEFAULT_AOI,
      enumeratePairs(DEFAULT_AOI)[5],
      cameraPinhole(DEFAULT_CAMERAS[1], 192),
      projectorPinhole(DEFAULT_PROJECTORS[0], 640),
    );
    const b = pairTheory(
      withReference,
      enumeratePairs(DEFAULT_AOI)[5],
      cameraPinhole(DEFAULT_CAMERAS[1], 192),
      projectorPinhole(DEFAULT_PROJECTORS[0], 640),
    );
    expect(a).toEqual(b);
  });

  it("exports per-cell CSV and a summary JSON with the disclaimer and no non-finite numbers", () => {
    const c = config({ cameras: [DEFAULT_CAMERAS[0]] });
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
    expect(header).toContain("h_C0-P3_mm");
    expect(header).toContain("reason_C0-P3");
    expect(csv.filter((l) => /^-?\d/.test(l))).toHaveLength(
      run.grid.nx * run.grid.ny,
    );
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
    expect(json.simulation.pairs[0].pair).toBe("C0-P3");
    expect(json.theory[0].window[1]).toBeGreaterThan(json.theory[0].window[0]);
  });
});
