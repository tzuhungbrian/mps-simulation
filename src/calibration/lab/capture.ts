import { createSeededRandom } from "../../core/simulation";
import type { Point2 } from "../camera";
import { findChessboardCorners } from "./corners";
import { remapAt, type CV } from "./opencv";
import { decodeAxis, fringeSequence, phaseToProjector } from "./phase";
import { expose, saturation, sceneTerms, shade } from "./render";
import {
  BOARD,
  FRINGE,
  cameraAt,
  placementPose,
  type BoardPlacement,
  type CaptureSettings,
} from "./rig";

export interface PhasePreview {
  width: number;
  height: number;
  /** Projector column / row decoded per (downsampled) camera pixel; NaN = invalid. */
  up: Float32Array;
  vp: Float32Array;
}

export interface Capture {
  width: number;
  height: number;
  /** The checkerboard photo (projector full white). */
  image: Uint8Array;
  /** One example fringe frame (finest vertical, δ = 0) for display. */
  fringe: Uint8Array | null;
  corners: Point2[] | null;
  /** Projector pixel at each corner from decoded phase (cv.remap); null where invalid. */
  projector: (Point2 | null)[] | null;
  phase: PhasePreview | null;
  saturated: number;
  blurSigma: number;
  /** Render, detection and fringe/phase timings, ms. */
  ms: { render: number; detect: number; fringes: number };
}

const PREVIEW = 4;

/** Photograph the board, find corners; if found, project 24 fringes and read the projector pixel at every corner. */
export function runCapture(
  placement: BoardPlacement,
  settings: CaptureSettings,
  seed: number,
  cv: CV,
): Capture {
  const t0 = performance.now();
  const K = cameraAt(settings.focusMm);
  const W = K.width,
    H = K.height;
  const terms = sceneTerms(K, placementPose(placement), settings, 2);
  const random = createSeededRandom(seed);
  const image = expose(shade(terms, null), settings, random);
  const t1 = performance.now();
  const corners = findChessboardCorners(image, W, H, BOARD.cols, BOARD.rows);
  const t2 = performance.now();
  let projector: Capture["projector"] = null,
    phase: PhasePreview | null = null,
    fringe: Uint8Array | null = null;
  if (corners) {
    const frames = fringeSequence().map((p) =>
      expose(shade(terms, p), settings, random),
    );
    const half = FRINGE.frequencies.length * FRINGE.steps;
    fringe = frames[half - FRINGE.steps];
    const ax = decodeAxis(frames.slice(0, half)).absolute.map((v) =>
      phaseToProjector(v, "x"),
    );
    const ay = decodeAxis(frames.slice(half)).absolute.map((v) =>
      phaseToProjector(v, "y"),
    );
    const u = remapAt(cv, ax, W, H, corners),
      v = remapAt(cv, ay, W, H, corners);
    projector = corners.map((_, i) =>
      Number.isFinite(u[i]) && Number.isFinite(v[i]) ? [u[i], v[i]] : null,
    );
    const pw = Math.floor(W / PREVIEW),
      ph = Math.floor(H / PREVIEW);
    const up = new Float32Array(pw * ph),
      vp = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++) {
        const src = y * PREVIEW * W + x * PREVIEW;
        up[y * pw + x] = ax[src];
        vp[y * pw + x] = ay[src];
      }
    phase = { width: pw, height: ph, up, vp };
  }
  return {
    width: W,
    height: H,
    image,
    fringe,
    corners,
    projector,
    phase,
    saturated: saturation(image),
    blurSigma: terms.sigma,
    ms: { render: t1 - t0, detect: t2 - t1, fringes: performance.now() - t2 },
  };
}
