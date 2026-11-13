import * as THREE from "three";
import type { Pinhole, Vec3 } from "../sandbox/geometry";
import { evaluateBrdf } from "../sandbox/lightTransport";
import { TAU } from "../core/simulation";
import {
  BOARD_SHAPES,
  focusDepth,
  heightSensitivity,
  phaseGradient,
  phaseNoise,
  rigTarget,
  surfaceMaterials,
  type WorldConfig,
} from "../sandbox/scanner";
import { SURFACE } from "../sandbox/pcb";
import {
  blurDiameter,
  blurSigma,
  CAMERA_BLUR_LIMIT,
  gaussianMtf,
  projectorBlurLimit,
} from "../sandbox/optics";
import type { Device } from "../sandbox/devices";
import type { PairInfo } from "./rig";

export { heightSensitivity, phaseNoise } from "../sandbox/scanner";

/** Reference-plane point below the aim point: where theory is evaluated. */
export const theoryPoint = (config: WorldConfig): Vec3 => {
  const [x, , z] = rigTarget(config);
  return [x, config.referenceHeight, z];
};

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

type CodingFields = Pick<
  WorldConfig,
  "coding" | "periodRatio" | "fringeFrequency"
>;

/** Unambiguous height span for the chosen coding, given Δh per 2π of the fine pattern. */
export function codingRange(per2Pi: number, config: CodingFields): number {
  if (config.coding === "dual")
    return (per2Pi * config.periodRatio) / (config.periodRatio - 1);
  if (config.coding === "temporal") return per2Pi * config.fringeFrequency;
  if (config.coding === "coarse") return per2Pi * config.periodRatio;
  return per2Pi;
}

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
 * on both patterns). Dual: σe = σφ·√(f₁² + f₂²)/(f₁ − f₂); coarse/fine: σφ·√(R² + 1);
 * temporal: σφ·√(f₁² + 1).
 */
export function orderErrorProbability(
  config: CodingFields,
  sigmaPhi: number,
): number {
  const f1 = config.fringeFrequency;
  if (config.coding === "single" || (config.coding === "temporal" && f1 <= 1))
    return 0;
  const sigmaE =
    config.coding === "dual"
      ? (sigmaPhi * Math.hypot(f1, f1 / config.periodRatio)) /
        (f1 - f1 / config.periodRatio)
      : config.coding === "coarse"
        ? sigmaPhi * Math.hypot(config.periodRatio, 1)
        : sigmaPhi * Math.hypot(f1, 1);
  if (!Number.isFinite(sigmaE)) return 1;
  return sigmaE === 0 ? 0 : Math.min(1, erfc(Math.PI / (Math.SQRT2 * sigmaE)));
}

/** Heights (relative to the reference plane) on the aim vertical whose blur stays ≤ maxBlur px. */
export function depthOfField(
  pinhole: Pinhole,
  device: Device,
  config: WorldConfig,
  maxBlur: number,
): [number, number] {
  if (!config.defocus || device.aperture === 0) return [-Infinity, Infinity];
  const t = theoryPoint(config);
  const s0 = t.reduce(
      (s, v, i) => s + (v - pinhole.position[i]) * pinhole.forward[i],
      0,
    ),
    slope = pinhole.forward[1];
  if (Math.abs(slope) < 1e-9) return [-Infinity, Infinity];
  const focus = 1 / focusDepth(pinhole, config),
    k = maxBlur / (pinhole.fx * device.aperture);
  const near = 1 / (focus + k),
    far = focus - k > 0 ? 1 / (focus - k) : Infinity;
  const heights = [near, far].map((s) =>
    Number.isFinite(s) ? (s - s0) / slope : slope < 0 ? -Infinity : Infinity,
  );
  return [Math.min(...heights), Math.max(...heights)];
}

export interface PairTheory {
  /** Fringe period on the board at the theory point, mm (from projector calibration). */
  boardPeriod: number;
  /** Far-field formula, rad/mm. */
  parallelSensitivity: number;
  /** Exact pinhole derivative at the theory point, rad/mm (signed). */
  geometricSensitivity: number;
  /** Min/max |dφ/dh| over the ROI corners and centre, rad/mm. */
  sensitivitySpan: [number, number];
  heightPer2Pi: number;
  parallelHeightPer2Pi: number;
  /** Unambiguous range for the configured coding, mm. */
  codingRange: number;
  /** Window [bottom, bottom + range] relative to the reference plane, mm. */
  window: [number, number];
  /** Modulation B predicted on the reference material at the theory point. */
  modulation: number;
  sigmaPhase: number;
  sigmaHeight: number;
  orderErrorProbability: number;
  /** Heights (relative to reference) where both devices stay within their blur criteria. */
  depthOfField: [number, number];
  /** Phase window clipped to the depth of field, mm. */
  effectiveRange: [number, number];
  /** Periods across the projector × Δh per 2π; constant for a pair. */
  rangeConstant: number;
  /** Highest fine frequency whose range still covers targetRange: single period / current coding. */
  maxFrequencySingle: number;
  maxFrequencyCoded: number;
  /** Ratio sweep at the configured fine frequency: heterodyne (dual) and coarse/fine (coarse). */
  ratios: {
    ratio: number;
    dualRange: number;
    dualOrderError: number;
    coarseRange: number;
    coarseOrderError: number;
  }[];
}

export const RATIO_SWEEP = [1.1, 1.25, 1.5, 2, 4, 8, 12, 16] as const;

/** Theoretical (calibration-only) characterisation of one pair; no scene or truth enters. */
export function pairTheory(
  config: WorldConfig,
  pair: PairInfo,
  camera: Pinhole,
  projector: Pinhole,
): PairTheory {
  const cam = config.cameras[pair.cameraIndex],
    proj = config.projectors[pair.projectorIndex],
    f1 = config.fringeFrequency,
    t = theoryPoint(config);
  const period = boardPeriod(projector, f1, t);
  const parallel = parallelSensitivity(
    pair.cameraTilt,
    pair.projectorTilt,
    pair.deltaAzimuth,
    period,
  );
  const geometric = heightSensitivity(camera, projector, f1, t);
  const hw = config.roiWidth / 2,
    hh = config.roiHeight / 2;
  const span = [
    [0, 0],
    [-hw, -hh],
    [hw, -hh],
    [-hw, hh],
    [hw, hh],
  ].map(([x, y]) =>
    Math.abs(
      heightSensitivity(camera, projector, f1, [t[0] + x, t[1], t[2] + y]),
    ),
  );
  const per2Pi = heightPer2Pi(geometric),
    range = codingRange(per2Pi, config);
  // Reference-plane modulation: exposure·π·BRDF·cos θi·amplitude, with projector defocus MTF.
  const n = new THREE.Vector3(0, 1, 0),
    wi = new THREE.Vector3(
      ...projector.position.map((v, i) => v - t[i]),
    ).normalize(),
    wo = new THREE.Vector3(
      ...camera.position.map((v, i) => v - t[i]),
    ).normalize();
  const projectorDepth = t.reduce(
    (s, v, i) => s + (v - projector.position[i]) * projector.forward[i],
    0,
  );
  const projectorMtf =
    config.defocus && proj.aperture > 0
      ? gaussianMtf(
          blurSigma(
            blurDiameter(
              projector.fx,
              proj.aperture,
              projectorDepth,
              focusDepth(projector, config),
            ),
          ),
          projector.width / f1,
        )
      : 1;
  const material =
    surfaceMaterials(config)[
      config.shape === "pcb" || BOARD_SHAPES.includes(config.shape)
        ? SURFACE.object
        : SURFACE.ground
    ];
  const modulation =
    config.exposure *
    Math.PI *
    evaluateBrdf(material, n, wi, wo) *
    Math.max(0, wi.y) *
    config.fringeAmplitude *
    projectorMtf;
  const sigmaPhase = phaseNoise(
    config.noiseSigma,
    config.phaseSteps,
    modulation,
  );
  const dofCamera = depthOfField(camera, cam, config, CAMERA_BLUR_LIMIT),
    dofProjector = depthOfField(
      projector,
      proj,
      config,
      projectorBlurLimit(projector.width, f1),
    );
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
    // Temporal unwrapping spans the whole projector whatever f is.
    maxFrequencyCoded:
      config.coding === "temporal"
        ? rangeConstant >= config.targetRange
          ? Infinity
          : 0
        : (rangeConstant * codingRange(1, config)) / config.targetRange,
    ratios: RATIO_SWEEP.map((ratio) => ({
      ratio,
      dualRange: (per2Pi * ratio) / (ratio - 1),
      dualOrderError: orderErrorProbability(
        { coding: "dual", periodRatio: ratio, fringeFrequency: f1 },
        sigmaPhase,
      ),
      coarseRange: per2Pi * ratio,
      coarseOrderError: orderErrorProbability(
        { coding: "coarse", periodRatio: ratio, fringeFrequency: f1 },
        sigmaPhase,
      ),
    })),
  };
}
