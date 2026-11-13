import * as THREE from "three";
import {
  dot,
  projectPoint,
  sub,
  type Pinhole,
  type Vec3,
} from "../sandbox/geometry";
import { evaluateBrdf } from "../sandbox/lightTransport";
import { TAU } from "../core/simulation";
import {
  AIM_POINT,
  type AoiConfig,
  type AoiDevice,
  type PairInfo,
} from "./rig";

/** Unwrapped projector phase ψ = 2πf(u + ½)/W at a world point (ψ = φ + π of the sandbox convention). */
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
  const o = sub(point, projector.position),
    a = dot(projector.right, o),
    b = dot(projector.forward, o);
  if (!(b > 0)) return null;
  const k = (TAU * frequency * projector.fx) / (projector.width * b * b);
  return [0, 1, 2].map(
    (i) => k * (projector.right[i] * b - projector.forward[i] * a),
  ) as Vec3;
}

/**
 * dψ/dh in rad/mm for a fixed camera pixel: the point slides along the camera
 * ray through `point` while its height h (world Y) changes.
 */
export function heightSensitivity(
  camera: Pinhole,
  projector: Pinhole,
  frequency: number,
  point: Vec3,
): number {
  const ray = sub(point, camera.position);
  const gradient = phaseGradient(projector, frequency, point);
  if (!gradient || Math.abs(ray[1]) < 1e-12) return NaN;
  return dot(gradient, ray) / ray[1];
}

/** Fringe period on the horizontal plane through `point`, mm. */
export function boardPeriod(
  projector: Pinhole,
  frequency: number,
  point: Vec3,
): number {
  const g = phaseGradient(projector, frequency, point);
  return g ? TAU / Math.hypot(g[0], g[2]) : NaN;
}

/**
 * Parallel-projection (far-field) approximation:
 * |dφ/dh| = (2π/p)·|tan θp − tan θc · cos Δα|, with p measured along the projector azimuth.
 */
export function parallelSensitivity(
  cameraTilt: number,
  projectorTilt: number,
  deltaAzimuth: number,
  period: number,
): number {
  const r = Math.PI / 180;
  return (
    (TAU / period) *
    Math.abs(
      Math.tan(projectorTilt * r) -
        Math.tan(cameraTilt * r) * Math.cos(deltaAzimuth * r),
    )
  );
}

export const heightPer2Pi = (sensitivity: number) =>
  Math.abs(sensitivity) > 0 ? TAU / Math.abs(sensitivity) : Infinity;

/** Unambiguous height span for the chosen coding, given Δh per 2π of the fine pattern. */
export function codingRange(
  per2Pi: number,
  config: Pick<AoiConfig, "coding" | "periodRatio" | "fringeFrequency">,
): number {
  if (config.coding === "dual")
    return (per2Pi * config.periodRatio) / (config.periodRatio - 1);
  if (config.coding === "temporal") return per2Pi * config.fringeFrequency;
  return per2Pi;
}

/** Least-squares N-step phase noise: σφ = σI·√(2/N) / B. */
export const phaseNoise = (
  sigmaI: number,
  steps: number,
  modulation: number,
) => (modulation > 0 ? (sigmaI * Math.sqrt(2 / steps)) / modulation : Infinity);

/** Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x),
    t = 1 / (1 + 0.3275911 * z),
    y =
      t *
      (0.254829592 +
        t *
          (-0.284496736 +
            t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

/**
 * Probability that noise picks the wrong fine fringe order (Gaussian, equal σφ
 * on both patterns). Dual: σe = σφ·√(f₁² + f₂²)/(f₁ − f₂); temporal: σφ·√(f₁² + 1).
 */
export function orderErrorProbability(
  config: Pick<AoiConfig, "coding" | "periodRatio" | "fringeFrequency">,
  sigmaPhi: number,
): number {
  if (config.coding === "single") return 0;
  const f1 = config.fringeFrequency;
  const sigmaE =
    config.coding === "dual"
      ? (sigmaPhi * Math.hypot(f1, f1 / config.periodRatio)) /
        (f1 - f1 / config.periodRatio)
      : sigmaPhi * Math.hypot(f1, 1);
  if (!Number.isFinite(sigmaE)) return 1;
  return sigmaE === 0 ? 0 : Math.min(1, erfc(Math.PI / (Math.SQRT2 * sigmaE)));
}

/** Thin-lens blur-circle diameter in pixels: c = fx·A·|1/s − 1/s_f| (f ≪ s). */
export const blurDiameter = (
  fx: number,
  aperture: number,
  depth: number,
  focusDepth: number,
) => fx * aperture * Math.abs(1 / depth - 1 / focusDepth);
/** Gaussian σ with the same second moment as a uniform disc of diameter c. */
export const blurSigma = (diameter: number) => diameter / 4;
/** Contrast left on a sinusoid of period P pixels after a Gaussian blur σ. */
export const gaussianMtf = (sigma: number, period: number) =>
  Math.exp((-2 * Math.PI * Math.PI * sigma * sigma) / (period * period));

/** Optical-axis depth of the aim-point vertical at height h: s = D − h·cos θ. */
export const axisDepth = (device: AoiDevice, height: number) =>
  device.distance - height * Math.cos((device.tilt * Math.PI) / 180);

/** Heights on the aim vertical whose blur stays ≤ maxBlur pixels. */
export function depthOfField(
  device: AoiDevice,
  fx: number,
  focusHeight: number,
  maxBlur: number,
): [number, number] {
  if (device.aperture === 0) return [-Infinity, Infinity];
  const cos = Math.cos((device.tilt * Math.PI) / 180),
    focus = 1 / axisDepth(device, focusHeight),
    k = maxBlur / (fx * device.aperture);
  const nearest = 1 / (focus + k),
    farthest = focus - k > 0 ? 1 / (focus - k) : Infinity;
  return [
    (device.distance - farthest) / cos,
    (device.distance - nearest) / cos,
  ];
}

/** Largest projector blur diameter (px) that keeps the fine-pattern MTF ≥ 0.5. */
export const projectorBlurLimit = (width: number, frequency: number) =>
  4 * (width / frequency / Math.PI) * Math.sqrt(Math.LN2 / 2);
/** Camera DOF criterion: blur diameter ≤ 2 px. */
export const CAMERA_BLUR_LIMIT = 2;

export interface PairTheory {
  /** Fringe period on the board at the aim point, mm (from projector calibration). */
  boardPeriod: number;
  /** Far-field formula, rad/mm. */
  parallelSensitivity: number;
  /** Exact pinhole derivative at the aim point, rad/mm (signed). */
  geometricSensitivity: number;
  /** Min/max |dφ/dh| over the ROI corners and centre, rad/mm. */
  sensitivitySpan: [number, number];
  heightPer2Pi: number;
  parallelHeightPer2Pi: number;
  /** Unambiguous range for the configured coding, mm. */
  codingRange: number;
  /** Window [bottom, bottom + range] in mm. */
  window: [number, number];
  /** Modulation B predicted on the reference material at the aim point. */
  modulation: number;
  sigmaPhase: number;
  sigmaHeight: number;
  orderErrorProbability: number;
  /** Heights where both devices stay within their blur criteria. */
  depthOfField: [number, number];
  /** Phase range clipped to the DOF window, mm. */
  effectiveRange: [number, number];
  /** Periods across the projector × Δh per 2π; constant for a pair. */
  rangeConstant: number;
  /** Highest fine frequency whose range still covers targetRange (single / dual coding). */
  maxFrequencySingle: number;
  maxFrequencyDual: number;
  /** Ratio sweep for dual-period coding at the configured fine frequency. */
  ratios: { ratio: number; range: number; orderErrorProbability: number }[];
}

export const RATIO_SWEEP = [1.1, 1.2, 1.25, 1.5, 2, 3] as const;

/** Theoretical (calibration-only) characterisation of one pair; no scene or truth enters. */
export function pairTheory(
  config: AoiConfig,
  pair: PairInfo,
  camera: Pinhole,
  projector: Pinhole,
): PairTheory {
  const cam = config.cameras[pair.cameraIndex],
    proj = config.projectors[pair.projectorIndex],
    f1 = config.fringeFrequency;
  const period = boardPeriod(projector, f1, AIM_POINT);
  const parallel = parallelSensitivity(
    pair.cameraTilt,
    pair.projectorTilt,
    pair.deltaAzimuth,
    period,
  );
  const geometric = heightSensitivity(camera, projector, f1, AIM_POINT);
  const hw = config.roiWidth / 2,
    hh = config.roiHeight / 2;
  const span = [
    [0, 0],
    [-hw, -hh],
    [hw, -hh],
    [-hw, hh],
    [hw, hh],
  ].map(([x, y]) =>
    Math.abs(heightSensitivity(camera, projector, f1, [x, 0, y])),
  );
  const per2Pi = heightPer2Pi(geometric),
    range = codingRange(per2Pi, config);
  // Reference-plane modulation: exposure·π·BRDF·cos θi·amplitude, with projector defocus MTF.
  const n = new THREE.Vector3(0, 1, 0),
    wi = new THREE.Vector3(...sub(projector.position, AIM_POINT)).normalize(),
    wo = new THREE.Vector3(...sub(camera.position, AIM_POINT)).normalize();
  const projectorFocus = axisDepth(proj, config.focusHeight);
  const projectorMtf = config.defocus
    ? gaussianMtf(
        blurSigma(
          blurDiameter(
            projector.fx,
            proj.aperture,
            proj.distance,
            projectorFocus,
          ),
        ),
        projector.width / f1,
      )
    : 1;
  const modulation =
    config.exposure *
    Math.PI *
    evaluateBrdf(config.materials.board, n, wi, wo) *
    Math.max(0, wi.y) *
    config.fringeAmplitude *
    projectorMtf;
  const sigmaPhase = phaseNoise(
    config.noiseSigma,
    config.phaseSteps,
    modulation,
  );
  const dofCamera = config.defocus
      ? depthOfField(cam, camera.fx, config.focusHeight, CAMERA_BLUR_LIMIT)
      : ([-Infinity, Infinity] as [number, number]),
    dofProjector = config.defocus
      ? depthOfField(
          proj,
          projector.fx,
          config.focusHeight,
          projectorBlurLimit(projector.width, f1),
        )
      : ([-Infinity, Infinity] as [number, number]);
  const dof: [number, number] = [
    Math.max(dofCamera[0], dofProjector[0]),
    Math.min(dofCamera[1], dofProjector[1]),
  ];
  const window: [number, number] =
    config.coding === "temporal"
      ? [-Infinity, Infinity]
      : [config.windowBottom, config.windowBottom + range];
  const rangeConstant = per2Pi * f1;
  return {
    boardPeriod: period,
    parallelSensitivity: parallel,
    geometricSensitivity: geometric,
    sensitivitySpan: [Math.min(...span), Math.max(...span)],
    heightPer2Pi: per2Pi,
    parallelHeightPer2Pi: heightPer2Pi(parallel),
    codingRange: range,
    window,
    modulation,
    sigmaPhase,
    sigmaHeight: sigmaPhase / Math.abs(geometric),
    orderErrorProbability: orderErrorProbability(config, sigmaPhase),
    depthOfField: dof,
    effectiveRange: [Math.max(window[0], dof[0]), Math.min(window[1], dof[1])],
    rangeConstant,
    maxFrequencySingle: rangeConstant / config.targetRange,
    maxFrequencyDual:
      (rangeConstant * config.periodRatio) /
      ((config.periodRatio - 1) * config.targetRange),
    ratios: RATIO_SWEEP.map((ratio) => ({
      ratio,
      range: (per2Pi * ratio) / (ratio - 1),
      orderErrorProbability: orderErrorProbability(
        { coding: "dual", periodRatio: ratio, fringeFrequency: f1 },
        sigmaPhase,
      ),
    })),
  };
}
