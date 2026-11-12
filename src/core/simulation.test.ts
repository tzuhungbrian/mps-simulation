import { describe, expect, it } from "vitest";
import * as simulation from "./simulation";

function analyticFrames(
  phases: number[],
  mean = 0.5,
  amplitude = 0.3,
): [Float64Array, Float64Array, Float64Array] {
  return [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((shift) =>
    Float64Array.from(
      phases,
      (phi) => mean + amplitude * Math.cos(phi + shift),
    ),
  ) as [Float64Array, Float64Array, Float64Array];
}

describe("analytic three-step inverse", () => {
  it.each([
    -Math.PI,
    -2.4,
    -Math.PI / 2,
    -0.2,
    0,
    0.2,
    Math.PI / 2,
    2.4,
    Math.PI,
  ])(
    "recovers signed phase %s and radiometry from only three intensities",
    (phi) => {
      const result = simulation.decodeThreeStep(
        analyticFrames([phi], 0.47, 0.24),
        0.02,
      );
      expect(result.valid[0]).toBe(1);
      expect(result.wrapped[0]).toBeCloseTo(simulation.wrapPhase(phi), 12);
      expect(result.mean[0]).toBeCloseTo(0.47, 14);
      expect(result.modulation[0]).toBeCloseTo(0.24, 14);
    },
  );
});

describe("decoder validity", () => {
  it.each([0, 0.01, 0.02])(
    "rejects modulation %s at or below threshold",
    (amplitude) => {
      const frames =
        amplitude === 0.02
          ? ([
              new Float64Array([0.52]),
              new Float64Array([0.49]),
              new Float64Array([0.49]),
            ] as [Float64Array, Float64Array, Float64Array])
          : analyticFrames([0.4], 0.5, amplitude);
      const threshold =
        amplitude === 0.02
          ? Math.hypot(
              Math.sqrt(3) * (frames[2][0] - frames[1][0]),
              2 * frames[0][0] - frames[1][0] - frames[2][0],
            ) / 3
          : 0.02;
      const result = simulation.decodeThreeStep(frames, threshold);
      expect(result.valid[0]).toBe(0);
      expect(result.wrapped[0]).toBeNaN();
    },
  );

  it("rejects saturation reported by the capture mask", () => {
    const result = simulation.decodeThreeStep(
      analyticFrames([0.2]),
      0,
      new Uint8Array([1]),
    );
    expect(result.valid[0]).toBe(0);
    expect(result.wrapped[0]).toBeNaN();
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite input %s", (bad) => {
    const frames = analyticFrames([0.2]);
    frames[1][0] = bad;
    const result = simulation.decodeThreeStep(frames, 0);
    expect(result.valid[0]).toBe(0);
    expect(result.wrapped[0]).toBeNaN();
  });

  it("rejects mismatched frame or mask sizes instead of silently truncating", () => {
    expect(() =>
      simulation.decodeThreeStep(
        [new Float64Array(2), new Float64Array(1), new Float64Array(2)],
        0,
      ),
    ).toThrow(RangeError);
    expect(() =>
      simulation.decodeThreeStep(analyticFrames([0]), 0, new Uint8Array(0)),
    ).toThrow(RangeError);
  });
});

describe("relative row unwrap", () => {
  it("recovers multiple cycles relative to the wrapped first sample, not ground truth order", () => {
    const truth = Float64Array.from(
      { length: 96 },
      (_, i) => 4 * Math.PI + 0.7 + 0.8 * i,
    );
    const wrapped = truth.map(simulation.wrapPhase);
    const result = simulation.unwrapRows(
      wrapped,
      new Uint8Array(96).fill(1),
      96,
    );
    expect(result[0]).toBe(wrapped[0]);
    truth.forEach((phi, i) =>
      expect(result[i]).toBeCloseTo(phi - 4 * Math.PI, 10),
    );
  });

  it("unwraps a descending branch crossing with its correct sign", () => {
    const result = simulation.unwrapRows(
      new Float64Array([-3, 3, 2.5]),
      new Uint8Array([1, 1, 1]),
      3,
    );
    expect(result[1]).toBeCloseTo(3 - 2 * Math.PI, 12);
    expect(result[2]).toBeCloseTo(2.5 - 2 * Math.PI, 12);
  });

  it("resets the anchor at each row", () => {
    const result = simulation.unwrapRows(
      new Float64Array([2.8, -2.8, -1.5, -1]),
      new Uint8Array([1, 1, 1, 1]),
      2,
    );
    expect(result[1]).toBeGreaterThan(Math.PI);
    expect(result[2]).toBe(-1.5);
  });

  it("leaves gaps NaN and never bridges an invalid or nonfinite sample", () => {
    const result = simulation.unwrapRows(
      new Float64Array([2.8, -2.8, 0, -2.5, NaN, 1]),
      new Uint8Array([1, 1, 0, 1, 1, 1]),
      6,
    );
    expect(result[2]).toBeNaN();
    expect(result[3]).toBe(-2.5);
    expect(result[4]).toBeNaN();
    expect(result[5]).toBe(1);
  });

  it("rejects invalid row dimensions or mismatched masks", () => {
    expect(() =>
      simulation.unwrapRows(new Float64Array(3), new Uint8Array(3), 2),
    ).toThrow(RangeError);
    expect(() =>
      simulation.unwrapRows(new Float64Array(3), new Uint8Array(2), 3),
    ).toThrow(RangeError);
    expect(() =>
      simulation.unwrapRows(new Float64Array(3), new Uint8Array(3), 0),
    ).toThrow(RangeError);
  });
});

describe("circular evaluation only", () => {
  it("measures short signed errors across the branch cut", () => {
    expect(
      simulation.circularDifference(-Math.PI + 0.1, Math.PI - 0.1),
    ).toBeCloseTo(0.2, 12);
    expect(
      simulation.circularDifference(Math.PI - 0.1, -Math.PI + 0.1),
    ).toBeCloseTo(-0.2, 12);
    const metrics = simulation.evaluatePhase(
      new Float64Array([-Math.PI + 0.1, 0.3]),
      new Uint8Array([1, 1]),
      new Float64Array([Math.PI - 0.1, 0]),
    );
    expect(metrics.rmse).toBeCloseTo(Math.sqrt((0.2 ** 2 + 0.3 ** 2) / 2), 12);
  });

  it("counts only masked finite pairs but divides ratio by all pixels", () => {
    const metrics = simulation.evaluatePhase(
      new Float64Array([0, NaN, 1, 2]),
      new Uint8Array([1, 1, 0, 1]),
      new Float64Array([0, 0, 1, Infinity]),
    );
    expect(metrics).toEqual({
      rmse: 0,
      validRatio: 0.25,
      validCount: 1,
      totalCount: 4,
    });
  });

  it("reports null RMSE rather than false zero when all samples are invalid", () => {
    expect(
      simulation.evaluatePhase(
        new Float64Array([0]),
        new Uint8Array([0]),
        new Float64Array([0]),
      ),
    ).toEqual({ rmse: null, validRatio: 0, validCount: 0, totalCount: 1 });
  });

  it("handles empty evaluation without dividing by zero", () => {
    expect(
      simulation.evaluatePhase(
        new Float64Array(0),
        new Uint8Array(0),
        new Float64Array(0),
      ),
    ).toEqual({ rmse: null, validRatio: 0, validCount: 0, totalCount: 0 });
  });

  it("rejects inconsistent evaluation array sizes", () => {
    expect(() =>
      simulation.evaluatePhase(
        new Float64Array(2),
        new Uint8Array(1),
        new Float64Array(2),
      ),
    ).toThrow(RangeError);
    expect(() =>
      simulation.evaluatePhase(
        new Float64Array(2),
        new Uint8Array(2),
        new Float64Array(1),
      ),
    ).toThrow(RangeError);
  });
});

const baseConfig = {
  width: 512,
  height: 192,
  frequency: 6,
  phaseOffset: 0.6,
  mean: 0.5,
  amplitude: 0.4,
  noiseSigma: 0,
  minModulation: 0.02,
  seed: 42,
};

describe("configuration boundary", () => {
  it("exports the agreed teaching defaults and phase shifts", () => {
    expect(simulation.DEFAULT_CONFIG).toEqual(baseConfig);
    expect(simulation.SHIFTS).toEqual([
      0,
      (2 * Math.PI) / 3,
      (4 * Math.PI) / 3,
    ]);
    expect(simulation.TAU).toBe(2 * Math.PI);
    expect(() => simulation.validateConfig(baseConfig)).not.toThrow();
  });

  it.each([
    ["width", 31],
    ["width", 2049],
    ["width", 32.5],
    ["height", 0],
    ["height", 1025],
    ["height", 1.5],
    ["frequency", 0.24],
    ["frequency", 32.01],
    ["phaseOffset", -2 * Math.PI - 0.01],
    ["phaseOffset", 2 * Math.PI + 0.01],
    ["mean", -0.01],
    ["mean", 1.01],
    ["amplitude", -0.01],
    ["amplitude", 0.501],
    ["noiseSigma", -0.01],
    ["noiseSigma", 0.151],
    ["minModulation", -0.01],
    ["minModulation", 0.301],
    ["seed", -1],
    ["seed", 4294967296],
    ["seed", 0.5],
  ])("rejects %s=%s", (field, value) => {
    expect(() =>
      simulation.validateConfig({ ...baseConfig, [field]: value }),
    ).toThrow(RangeError);
  });

  it.each(Object.keys(baseConfig))("rejects nonfinite %s", (field) => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() =>
        simulation.validateConfig({ ...baseConfig, [field]: value }),
      ).toThrow(RangeError);
    }
  });

  it("rejects Nyquist equality and aliased frequencies even within the global range", () => {
    expect(() =>
      simulation.validateConfig({ ...baseConfig, width: 32, frequency: 15.5 }),
    ).toThrow(RangeError);
    expect(() =>
      simulation.validateConfig({ ...baseConfig, width: 32, frequency: 16 }),
    ).toThrow(RangeError);
    expect(() =>
      simulation.validateConfig({ ...baseConfig, width: 32, frequency: 15.49 }),
    ).not.toThrow();
  });

  it("accepts inclusive supported bounds", () => {
    expect(() =>
      simulation.validateConfig({
        width: 32,
        height: 1,
        frequency: 0.25,
        phaseOffset: -2 * Math.PI,
        mean: 0,
        amplitude: 0,
        noiseSigma: 0,
        minModulation: 0,
        seed: 0,
      }),
    ).not.toThrow();
    expect(() =>
      simulation.validateConfig({
        width: 2048,
        height: 1024,
        frequency: 32,
        phaseOffset: 2 * Math.PI,
        mean: 1,
        amplitude: 0.5,
        noiseSigma: 0.15,
        minModulation: 0.3,
        seed: 4294967295,
      }),
    ).not.toThrow();
  });

  it("parses untrusted persisted objects without coercion or mutation", () => {
    const source = { ...baseConfig, ignored: "not a config field" };
    expect(simulation.parseConfig(source)).toEqual(baseConfig);
    expect(simulation.parseConfig(source)).not.toBe(source);
    expect(source.ignored).toBe("not a config field");
    for (const bad of [
      null,
      [],
      42,
      "config",
      {},
      { ...baseConfig, width: "512" },
    ]) {
      expect(() => simulation.parseConfig(bad)).toThrow(RangeError);
    }
  });
});

describe("seeded random source", () => {
  it("replays identical seeds including zero without sharing generator state", () => {
    for (const seed of [0, 42, 4294967295]) {
      const first = simulation.createSeededRandom(seed);
      const second = simulation.createSeededRandom(seed);
      const samples = Array.from({ length: 1000 }, first);
      expect(samples).toEqual(Array.from({ length: 1000 }, second));
      expect(samples.every((v) => v >= 0 && v < 1)).toBe(true);
      expect(new Set(samples).size).toBeGreaterThan(990);
    }
  });

  it("changes the stream when the seed changes", () => {
    const a = simulation.createSeededRandom(42);
    const b = simulation.createSeededRandom(43);
    expect(Array.from({ length: 10 }, a)).not.toEqual(
      Array.from({ length: 10 }, b),
    );
  });
});

describe("synthetic forward model", () => {
  it("samples the prescribed three shifted cosines at x/(width-1) and repeats ideal rows", () => {
    const config = {
      ...baseConfig,
      width: 32,
      height: 2,
      frequency: 2,
      noiseSigma: 0,
    };
    const captures = simulation.generateCaptures(config);
    expect(captures.width).toBe(32);
    expect(captures.height).toBe(2);
    expect(captures.frames.map((frame) => frame.length)).toEqual([64, 64, 64]);
    expect(captures.clipped).toEqual(new Uint8Array(64));
    for (let i = 0; i < 64; i++) {
      const phi = (2 * Math.PI * 2 * (i % 32)) / 31 + 0.6;
      expect(captures.referencePhase[i]).toBeCloseTo(phi, 13);
      for (let k = 0; k < 3; k++) {
        expect(captures.frames[k][i]).toBeCloseTo(
          0.5 + 0.4 * Math.cos(phi + simulation.SHIFTS[k]),
          14,
        );
      }
    }
  });

  it("clamps out-of-range intensities and invalidates any clipped frame at a pixel", () => {
    const captures = simulation.generateCaptures({
      ...baseConfig,
      width: 32,
      height: 1,
      mean: 0.1,
      amplitude: 0.5,
    });
    const phase = simulation.decodeThreeStep(
      captures.frames,
      0,
      captures.clipped,
    );
    expect(captures.clipped.some((v) => v === 1)).toBe(true);
    for (let i = 0; i < 32; i++) {
      const atBoundary = captures.frames.some(
        (frame) => frame[i] <= 0 || frame[i] >= 1,
      );
      expect(captures.clipped[i]).toBe(atBoundary ? 1 : 0);
      if (atBoundary) expect(phase.valid[i]).toBe(0);
      for (const frame of captures.frames)
        expect(frame[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it.each([0, 1])("marks exact boundary intensity %s as clipped", (mean) => {
    const captures = simulation.generateCaptures({
      ...baseConfig,
      width: 32,
      height: 1,
      mean,
      amplitude: 0,
    });
    expect(captures.clipped).toEqual(new Uint8Array(32).fill(1));
    expect(captures.frames[0]).toEqual(new Float64Array(32).fill(mean));
  });

  it("rejects unsupported capture dimensions before allocating images", () => {
    expect(() =>
      simulation.generateCaptures({ ...baseConfig, width: 1e9 }),
    ).toThrow(RangeError);
  });
});

describe("independent Gaussian capture noise", () => {
  it("replays the same seed and changes noisy captures for another seed", () => {
    const config = { ...baseConfig, width: 32, height: 2, noiseSigma: 0.03 };
    const first = simulation.generateCaptures(config);
    expect(simulation.generateCaptures(config)).toEqual(first);
    expect(
      simulation.generateCaptures({ ...config, seed: 43 }).frames,
    ).not.toEqual(first.frames);
    expect(first.frames[0].slice(0, 32)).not.toEqual(first.frames[0].slice(32));
  });

  it("has near-zero residual mean, prescribed variance and independent frame residuals", () => {
    const config = {
      ...baseConfig,
      width: 512,
      height: 128,
      amplitude: 0.25,
      noiseSigma: 0.01,
    };
    const noisy = simulation.generateCaptures(config);
    const ideal = simulation.generateCaptures({ ...config, noiseSigma: 0 });
    const residuals = noisy.frames.map((frame, k) =>
      frame.map((v, i) => v - ideal.frames[k][i]),
    );
    const n = residuals[0].length;
    for (const residual of residuals) {
      const mean = residual.reduce((sum, v) => sum + v, 0) / n;
      const variance =
        residual.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
      expect(Math.abs(mean)).toBeLessThan(0.0002);
      expect(variance / config.noiseSigma ** 2).toBeGreaterThan(0.97);
      expect(variance / config.noiseSigma ** 2).toBeLessThan(1.03);
    }
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const covariance =
        residuals[a].reduce((sum, v, i) => sum + v * residuals[b][i], 0) / n;
      expect(Math.abs(covariance / config.noiseSigma ** 2)).toBeLessThan(0.02);
    }
    expect(noisy.clipped.some(Boolean)).toBe(false);
  });
});

describe("composed numerical pipeline", () => {
  it("composes captures, intensity-only decoding, relative unwrap and evaluation", () => {
    const result = simulation.runSimulation({
      ...baseConfig,
      width: 64,
      height: 2,
    });
    expect(result.phase).toEqual(
      simulation.decodeThreeStep(
        result.captures.frames,
        baseConfig.minModulation,
        result.captures.clipped,
      ),
    );
    expect(result.unwrapped).toEqual(
      simulation.unwrapRows(result.phase.wrapped, result.phase.valid, 64),
    );
    expect(result.metrics).toEqual(
      simulation.evaluatePhase(
        result.phase.wrapped,
        result.phase.valid,
        result.captures.referencePhase,
      ),
    );
    expect(result.metrics.validRatio).toBe(1);
    expect(result.metrics.rmse).toBeLessThan(1e-12);
    expect(result.unwrapped[63]).toBeCloseTo(2 * Math.PI * 6 + 0.6, 10);
  });

  it("cannot recover absolute fringe order from the synthetic reference", () => {
    const result = simulation.runSimulation({
      ...baseConfig,
      width: 64,
      height: 1,
      phaseOffset: 4,
    });
    expect(result.unwrapped[0]).toBeCloseTo(4 - 2 * Math.PI, 12);
    const originalDecoded = result.phase.wrapped.slice();
    const originalUnwrapped = result.unwrapped.slice();
    result.captures.referencePhase.fill(123456);
    const phase = simulation.decodeThreeStep(
      result.captures.frames,
      baseConfig.minModulation,
      result.captures.clipped,
    );
    expect(phase.wrapped).toEqual(originalDecoded);
    expect(simulation.unwrapRows(phase.wrapped, phase.valid, 64)).toEqual(
      originalUnwrapped,
    );
    expect(
      simulation.evaluatePhase(
        phase.wrapped,
        phase.valid,
        result.captures.referencePhase,
      ).rmse,
    ).toBeGreaterThan(0.1);
  });

  it("does not mutate configuration or input frame arrays", () => {
    const config = Object.freeze({ ...baseConfig, width: 32, height: 1 });
    const result = simulation.runSimulation(config);
    const snapshot = result.captures.frames.map((frame) => frame.slice());
    simulation.decodeThreeStep(
      result.captures.frames,
      config.minModulation,
      result.captures.clipped,
    );
    simulation.unwrapRows(result.phase.wrapped, result.phase.valid, 32);
    expect(result.captures.frames).toEqual(snapshot);
    expect(config).toEqual({ ...baseConfig, width: 32, height: 1 });
  });

  it("reports no valid phase for a zero-modulation experiment", () => {
    const result = simulation.runSimulation({
      ...baseConfig,
      width: 32,
      height: 1,
      amplitude: 0,
    });
    expect(result.metrics).toEqual({
      rmse: null,
      validRatio: 0,
      validCount: 0,
      totalCount: 32,
    });
    expect(result.unwrapped.every(Number.isNaN)).toBe(true);
  });

  it.each([0.005, 0.01, 0.02])(
    "matches the high-SNR phase noise law at intensity sigma=%s",
    (noiseSigma) => {
      const result = simulation.runSimulation({
        ...baseConfig,
        width: 512,
        height: 128,
        amplitude: 0.25,
        noiseSigma,
      });
      const predicted = (Math.sqrt(2 / 3) * noiseSigma) / 0.25;
      expect(result.metrics.validRatio).toBe(1);
      expect(result.metrics.rmse).not.toBeNull();
      expect(result.metrics.rmse! / predicted).toBeGreaterThan(0.97);
      expect(result.metrics.rmse! / predicted).toBeLessThan(1.03);
    },
  );
});

describe("phase convention", () => {
  it("normalizes the positive pi boundary to negative pi", () => {
    expect(simulation.wrapPhase(Math.PI)).toBe(-Math.PI);
    expect(simulation.wrapPhase(-Math.PI)).toBe(-Math.PI);
    expect(simulation.wrapPhase(0)).toBe(0);
    expect(simulation.wrapPhase(7 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(simulation.wrapPhase(-8 * Math.PI + 0.3)).toBeCloseTo(0.3, 12);
  });
});
