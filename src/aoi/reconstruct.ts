import { decodeNStep, TAU } from "../core/simulation";
import {
  cameraRay,
  projectPoint,
  triangulateColumn,
  type Pinhole,
  type Vec3,
} from "../sandbox/geometry";
import { insideProjector } from "../sandbox/scanner";
import { cellOf, type AoiConfig, type GridSpec } from "./rig";
import { heightSensitivity, phaseNoise, projectorPhase } from "./sensitivity";

/** Everything the AOI knows about its fringe coding and sensor; no scene or truth. */
export type AoiCoding = Pick<
  AoiConfig,
  | "phaseSteps"
  | "fringeFrequency"
  | "coding"
  | "periodRatio"
  | "windowBottom"
  | "minModulation"
> & {
  /** Camera read-noise specification, used only to weight measurements. */
  sensorNoise: number;
};

export const codingOf = (config: AoiConfig): AoiCoding => ({
  phaseSteps: config.phaseSteps,
  fringeFrequency: config.fringeFrequency,
  coding: config.coding,
  periodRatio: config.periodRatio,
  windowBottom: config.windowBottom,
  minModulation: config.minModulation,
  sensorNoise: config.noiseSigma,
});

export interface PairReconstruction {
  width: number;
  height: number;
  /** All patterns decoded (modulation above threshold, not clipped). */
  decoded: Uint8Array;
  valid: Uint8Array;
  validCount: number;
  /** World points, NaN where invalid. */
  points: Float64Array;
  /** Fine-pattern modulation B. */
  modulation: Float64Array;
  /** |dφ/dh| at the reconstructed point, rad/mm. */
  sensitivity: Float64Array;
  /** Predicted height noise from B, σ_sensor and |dφ/dh|, mm. */
  sigmaHeight: Float64Array;
}

const mod = (x: number) => ((x % TAU) + TAU) % TAU;
/** Choose the 2π branch that puts the point inside [bottom, bottom + range) along the ray. */
const windowed = (wrapped: number, reference: number, direction: number) =>
  reference + direction * mod(direction * (wrapped - reference));

/** Floor so that a noiseless simulation still yields finite fusion weights. */
const NOISE_FLOOR = 1e-4;

/**
 * Inverse boundary: only frames, clipping flags, the known coding and the
 * calibrated pinholes enter. The phase window is anchored on the calibrated
 * reference plane (height = windowBottom), never on the scene.
 */
export function reconstructPair(
  captures: {
    width: number;
    height: number;
    frames: Float64Array[];
    clipped: Uint8Array;
  },
  camera: Pinhole,
  projector: Pinhole,
  coding: AoiCoding,
): PairReconstruction {
  const { width, height, frames, clipped } = captures,
    count = width * height,
    n = coding.phaseSteps,
    f1 = coding.fringeFrequency;
  const expected = coding.coding === "single" ? n : 2 * n;
  if (
    camera.width !== width ||
    camera.height !== height ||
    frames.length !== expected ||
    frames.some((frame) => frame.length !== count) ||
    clipped.length !== count
  )
    throw new RangeError("Captures do not match the coding or calibration");
  const fine = decodeNStep(frames.slice(0, n), coding.minModulation, clipped);
  const coarse =
    expected > n
      ? decodeNStep(frames.slice(n), coding.minModulation, clipped)
      : null;
  const f2 =
    coding.coding === "dual"
      ? f1 / coding.periodRatio
      : coding.coding === "temporal"
        ? 1
        : 0;
  const windowFrequency = coding.coding === "dual" ? f1 - f2 : f1;
  const result: PairReconstruction = {
    width,
    height,
    decoded: new Uint8Array(count),
    valid: new Uint8Array(count),
    validCount: 0,
    points: new Float64Array(3 * count).fill(NaN),
    modulation: fine.modulation,
    sensitivity: new Float64Array(count).fill(NaN),
    sigmaHeight: new Float64Array(count).fill(NaN),
  };
  const sensor = Math.max(coding.sensorNoise, NOISE_FLOOR);
  for (let i = 0; i < count; i++) {
    if (!fine.valid[i] || (coarse && !coarse.valid[i])) continue;
    result.decoded[i] = 1;
    const x = i % width,
      y = Math.floor(i / width);
    const psi1 = mod(fine.wrapped[i] + Math.PI);
    let absolute: number;
    if (coding.coding === "temporal") {
      const predicted = f1 * mod(coarse!.wrapped[i] + Math.PI);
      absolute = psi1 + TAU * Math.round((predicted - psi1) / TAU);
    } else {
      const ray = cameraRay(camera, x, y);
      if (Math.abs(ray[1]) < 1e-12) continue;
      const t = (coding.windowBottom - camera.position[1]) / ray[1];
      if (!(t > 0)) continue;
      const bottom = camera.position.map((c, k) => c + t * ray[k]) as Vec3;
      const reference = projectorPhase(projector, windowFrequency, bottom);
      const slope = heightSensitivity(camera, projector, 1, bottom);
      if (reference === null || !Number.isFinite(slope) || slope === 0)
        continue;
      const direction = Math.sign(slope);
      if (coding.coding === "single")
        absolute = windowed(psi1, reference, direction);
      else {
        const beat = windowed(
          mod(psi1 - mod(coarse!.wrapped[i] + Math.PI)),
          reference,
          direction,
        );
        const predicted = (beat * f1) / windowFrequency;
        absolute = psi1 + TAU * Math.round((predicted - psi1) / TAU);
      }
    }
    const u = (projector.width * absolute) / (TAU * f1) - 0.5;
    if (!Number.isFinite(u) || u < -0.5 || u >= projector.width - 0.5) continue;
    const point = triangulateColumn(camera, projector, x, y, u);
    if (!point || !insideProjector(projector, projectPoint(projector, point)))
      continue;
    const sensitivity = Math.abs(
      heightSensitivity(camera, projector, f1, point),
    );
    result.points.set(point, 3 * i);
    result.valid[i] = 1;
    result.validCount++;
    result.sensitivity[i] = sensitivity;
    result.sigmaHeight[i] =
      phaseNoise(sensor, n, fine.modulation[i]) / sensitivity;
  }
  return result;
}

/** Per-cell height on the unified board grid (truth-free). */
export interface HeightMap {
  /** Median reconstructed height of the points in the cell, NaN when empty. */
  height: Float64Array;
  /** Predicted σ of that median, mm. */
  sigma: Float64Array;
  count: Uint16Array;
}

export function binToGrid(
  reconstruction: Pick<PairReconstruction, "valid" | "points" | "sigmaHeight">,
  grid: GridSpec,
): HeightMap {
  const cells = grid.nx * grid.ny;
  const buckets: number[][] = Array.from({ length: cells }, () => []);
  const variance = new Float64Array(cells);
  const { valid, points, sigmaHeight } = reconstruction;
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) continue;
    const cell = cellOf(grid, points[3 * i], points[3 * i + 2]);
    if (cell < 0) continue;
    buckets[cell].push(points[3 * i + 1]);
    variance[cell] += sigmaHeight[i] ** 2;
  }
  const map: HeightMap = {
    height: new Float64Array(cells).fill(NaN),
    sigma: new Float64Array(cells).fill(NaN),
    count: new Uint16Array(cells),
  };
  for (let c = 0; c < cells; c++) {
    const values = buckets[c];
    const n = values.length;
    if (!n) continue;
    values.sort((a, b) => a - b);
    map.height[c] =
      n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
    // Median of n samples: efficiency factor √(π/2) on the σ of the mean.
    map.sigma[c] =
      Math.sqrt(Math.PI / 2) * (Math.sqrt(variance[c] / n) / Math.sqrt(n));
    map.count[c] = Math.min(65535, n);
  }
  return map;
}
