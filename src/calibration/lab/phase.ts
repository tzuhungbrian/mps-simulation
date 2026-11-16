import { FRINGE, LAB_PROJECTOR } from "./rig";
import type { Pattern } from "./render";

const TAU = 2 * Math.PI;

/** Capture order: vertical fringes (x) then horizontal (y); each coarse → fine; each N shifts. */
export function fringeSequence(): Exclude<Pattern, null>[] {
  const out: Exclude<Pattern, null>[] = [];
  for (const axis of ["x", "y"] as const)
    for (const frequency of FRINGE.frequencies)
      for (let k = 0; k < FRINGE.steps; k++)
        out.push({ axis, frequency, shift: (TAU * k) / FRINGE.steps });
  return out;
}

/** N-step decoding of I_k = A + B cos(φ + 2πk/N). */
export function decodeWrapped(frames: Uint8Array[], minModulation: number) {
  const N = frames.length,
    n = frames[0].length;
  const phase = new Float32Array(n),
    modulation = new Float32Array(n);
  const cos = Array.from({ length: N }, (_, k) => Math.cos((TAU * k) / N)),
    sin = Array.from({ length: N }, (_, k) => Math.sin((TAU * k) / N));
  for (let i = 0; i < n; i++) {
    let S = 0,
      C = 0,
      clipped = false;
    for (let k = 0; k < N; k++) {
      const v = frames[k][i];
      if (v >= 255) clipped = true;
      S += v * sin[k];
      C += v * cos[k];
    }
    const B = (2 / N) * Math.hypot(S, C);
    modulation[i] = B;
    phase[i] = clipped || B < minModulation ? NaN : Math.atan2(-S, C);
  }
  return { phase, modulation };
}

/** Hierarchical temporal unwrapping; returns the absolute phase of the finest frequency. */
export function unwrapTemporal(
  wrapped: Float32Array[],
  frequencies: number[],
): Float32Array {
  const n = wrapped[0].length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let Phi = wrapped[0][i];
    Phi = ((Phi % TAU) + TAU) % TAU;
    for (let f = 1; f < frequencies.length && !Number.isNaN(Phi); f++) {
      const r = frequencies[f] / frequencies[f - 1];
      const phi = wrapped[f][i];
      Phi = phi + TAU * Math.round((r * Phi - phi) / TAU);
    }
    out[i] = Phi;
  }
  return out;
}

/** Absolute phase → projector pixel along the given axis. */
export const phaseToProjector = (Phi: number, axis: "x" | "y") =>
  (Phi * (axis === "x" ? LAB_PROJECTOR.width : LAB_PROJECTOR.height)) /
  (TAU * FRINGE.frequencies[FRINGE.frequencies.length - 1]);

/** Decode one axis (frames in fringeSequence order for that axis). */
export function decodeAxis(frames: Uint8Array[], minModulation = 6) {
  const N = FRINGE.steps;
  const decoded = FRINGE.frequencies.map((_, f) =>
    decodeWrapped(frames.slice(f * N, (f + 1) * N), minModulation),
  );
  return {
    absolute: unwrapTemporal(
      decoded.map((d) => d.phase),
      FRINGE.frequencies,
    ),
    modulation: decoded[decoded.length - 1].modulation,
  };
}
