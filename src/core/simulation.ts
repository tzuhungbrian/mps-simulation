export const TAU = 2 * Math.PI;
export const SHIFTS = [0, TAU / 3, (2 * TAU) / 3] as const;

export interface SimulationConfig {
  width: number;
  height: number;
  frequency: number;
  phaseOffset: number;
  mean: number;
  amplitude: number;
  noiseSigma: number;
  minModulation: number;
  seed: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
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

const CONFIG_LIMITS: Record<
  keyof SimulationConfig,
  readonly [number, number, boolean]
> = {
  width: [32, 2048, true],
  height: [1, 1024, true],
  frequency: [0.25, 32, false],
  phaseOffset: [-TAU, TAU, false],
  mean: [0, 1, false],
  amplitude: [0, 0.5, false],
  noiseSigma: [0, 0.15, false],
  minModulation: [0, 0.3, false],
  seed: [0, 4294967295, true],
};

export function validateConfig(config: SimulationConfig): void {
  for (const key of Object.keys(CONFIG_LIMITS) as (keyof SimulationConfig)[]) {
    const [min, max, integer] = CONFIG_LIMITS[key];
    const value = config[key];
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      throw new RangeError(
        `${key} must be ${integer ? "an integer" : "a finite number"} in [${min}, ${max}]`,
      );
    }
  }
  if (config.frequency >= (config.width - 1) / 2) {
    throw new RangeError(
      "frequency must be strictly below (width - 1) / 2 (Nyquist)",
    );
  }
}

/** Return a validated field-only copy, or throw RangeError; never coerce JSON values. */
export function parseConfig(value: unknown): SimulationConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError("Configuration must be an object");
  }
  const record = value as Record<string, unknown>;
  const config = {} as SimulationConfig;
  for (const key of Object.keys(CONFIG_LIMITS) as (keyof SimulationConfig)[]) {
    if (typeof record[key] !== "number")
      throw new RangeError(`${key} must be a number`);
    config[key] = record[key];
  }
  validateConfig(config);
  return config;
}

/** Mulberry32: a reproducible teaching PRNG, not a cryptographic source. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Captures {
  width: number;
  height: number;
  frames: [Float64Array, Float64Array, Float64Array];
  clipped: Uint8Array;
  /** Synthetic truth for evaluation only. */
  referencePhase: Float64Array;
}

export function generateCaptures(config: SimulationConfig): Captures {
  validateConfig(config);
  const random = createSeededRandom(config.seed);
  // Box-Muller: 1-U is in (0,1], so log never receives zero.
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
  const count = config.width * config.height;
  const captures: Captures = {
    width: config.width,
    height: config.height,
    frames: [
      new Float64Array(count),
      new Float64Array(count),
      new Float64Array(count),
    ],
    clipped: new Uint8Array(count),
    referencePhase: new Float64Array(count),
  };
  for (let i = 0; i < count; i++) {
    const phi =
      (TAU * config.frequency * (i % config.width)) / (config.width - 1) +
      config.phaseOffset;
    captures.referencePhase[i] = phi;
    for (let k = 0; k < 3; k++) {
      const noise =
        config.noiseSigma === 0 ? 0 : config.noiseSigma * gaussian();
      const value =
        config.mean + config.amplitude * Math.cos(phi + SHIFTS[k]) + noise;
      if (value <= 0 || value >= 1) captures.clipped[i] = 1;
      captures.frames[k][i] = Math.max(0, Math.min(1, value));
    }
  }
  return captures;
}

export interface PhaseResult {
  wrapped: Float64Array;
  mean: Float64Array;
  modulation: Float64Array;
  valid: Uint8Array;
}

/** Decode intensities only: no reference phase or fringe order is accepted. */
export function decodeThreeStep(
  frames: [Float64Array, Float64Array, Float64Array],
  minModulation: number,
  clipped?: Uint8Array,
): PhaseResult {
  const count = frames[0].length;
  if (
    frames[1].length !== count ||
    frames[2].length !== count ||
    (clipped && clipped.length !== count)
  ) {
    throw new RangeError("Frame and clipping-mask lengths must match");
  }
  const result: PhaseResult = {
    wrapped: new Float64Array(count),
    mean: new Float64Array(count),
    modulation: new Float64Array(count),
    valid: new Uint8Array(count),
  };
  for (let i = 0; i < count; i++) {
    const a = frames[0][i];
    const b = frames[1][i];
    const c = frames[2][i];
    const numerator = Math.sqrt(3) * (c - b);
    const denominator = 2 * a - b - c;
    result.mean[i] = (a + b + c) / 3;
    result.modulation[i] = Math.hypot(numerator, denominator) / 3;
    const finite =
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Number.isFinite(c) &&
      Number.isFinite(result.mean[i]) &&
      Number.isFinite(result.modulation[i]);
    const valid =
      finite && result.modulation[i] > minModulation && !clipped?.[i];
    result.wrapped[i] = valid
      ? wrapPhase(Math.atan2(numerator, denominator))
      : NaN;
    result.valid[i] = valid ? 1 : 0;
  }
  return result;
}

/** N-step decoding with shifts 2πk/N; delegates to decodeThreeStep for N = 3. */
export function decodeNStep(
  frames: readonly Float64Array[],
  minModulation: number,
  clipped?: Uint8Array,
): PhaseResult {
  const n = frames.length;
  if (n === 3)
    return decodeThreeStep(
      frames as [Float64Array, Float64Array, Float64Array],
      minModulation,
      clipped,
    );
  if (n < 3) throw new RangeError("N-step decoding needs at least 3 frames");
  const count = frames[0].length;
  if (
    frames.some((frame) => frame.length !== count) ||
    (clipped && clipped.length !== count)
  )
    throw new RangeError("Frame and clipping-mask lengths must match");
  const sines = frames.map((_, k) => Math.sin((TAU * k) / n)),
    cosines = frames.map((_, k) => Math.cos((TAU * k) / n));
  const result: PhaseResult = {
    wrapped: new Float64Array(count),
    mean: new Float64Array(count),
    modulation: new Float64Array(count),
    valid: new Uint8Array(count),
  };
  for (let i = 0; i < count; i++) {
    let s = 0,
      c = 0,
      sum = 0;
    for (let k = 0; k < n; k++) {
      const v = frames[k][i];
      s += v * sines[k];
      c += v * cosines[k];
      sum += v;
    }
    result.mean[i] = sum / n;
    result.modulation[i] = (2 / n) * Math.hypot(s, c);
    const valid =
      Number.isFinite(result.mean[i]) &&
      Number.isFinite(result.modulation[i]) &&
      result.modulation[i] > minModulation &&
      !clipped?.[i];
    result.wrapped[i] = valid ? wrapPhase(Math.atan2(-s, c)) : NaN;
    result.valid[i] = valid ? 1 : 0;
  }
  return result;
}

/** Each valid segment has an independent, unknown integer fringe order. */
export function unwrapRows(
  wrapped: Float64Array,
  valid: Uint8Array,
  width: number,
): Float64Array {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    wrapped.length % width !== 0 ||
    valid.length !== wrapped.length
  ) {
    throw new RangeError("Unwrap requires matching arrays and complete rows");
  }
  const result = new Float64Array(wrapped.length).fill(NaN);
  let anchored = false;
  let previousWrapped = 0;
  let previousUnwrapped = 0;
  for (let i = 0; i < wrapped.length; i++) {
    if (i % width === 0) anchored = false;
    if (!valid[i] || !Number.isFinite(wrapped[i])) {
      anchored = false;
      continue;
    }
    const current = wrapped[i];
    result[i] = anchored
      ? previousUnwrapped + wrapPhase(current - previousWrapped)
      : current;
    previousWrapped = current;
    previousUnwrapped = result[i];
    anchored = true;
  }
  return result;
}

export interface PhaseMetrics {
  rmse: number | null;
  validRatio: number;
  validCount: number;
  totalCount: number;
}

export function circularDifference(a: number, b: number): number {
  return wrapPhase(a - b);
}

/** Synthetic reference is permitted here, never in decoding or unwrapping. */
export function evaluatePhase(
  wrapped: Float64Array,
  valid: Uint8Array,
  referencePhase: Float64Array,
): PhaseMetrics {
  const totalCount = wrapped.length;
  if (valid.length !== totalCount || referencePhase.length !== totalCount) {
    throw new RangeError("Evaluation array lengths must match");
  }
  let squaredError = 0;
  let validCount = 0;
  for (let i = 0; i < totalCount; i++) {
    if (
      !valid[i] ||
      !Number.isFinite(wrapped[i]) ||
      !Number.isFinite(referencePhase[i])
    )
      continue;
    const error = circularDifference(wrapped[i], referencePhase[i]);
    squaredError += error * error;
    validCount++;
  }
  return {
    rmse: validCount ? Math.sqrt(squaredError / validCount) : null,
    validRatio: totalCount ? validCount / totalCount : 0,
    validCount,
    totalCount,
  };
}

export interface SimulationResult {
  captures: Captures;
  phase: PhaseResult;
  unwrapped: Float64Array;
  metrics: PhaseMetrics;
}

export function runSimulation(config: SimulationConfig): SimulationResult {
  const captures = generateCaptures(config);
  const phase = decodeThreeStep(
    captures.frames,
    config.minModulation,
    captures.clipped,
  );
  const unwrapped = unwrapRows(phase.wrapped, phase.valid, config.width);
  const metrics = evaluatePhase(
    phase.wrapped,
    phase.valid,
    captures.referencePhase,
  );
  return { captures, phase, unwrapped, metrics };
}

/** Principal angle in [-pi, pi); no fringe-order information is added. */
export function wrapPhase(phi: number): number {
  return ((((phi + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}
