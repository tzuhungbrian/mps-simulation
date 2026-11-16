import { gaussian, mul3, type Vec3 } from "../linalg";
import { distort, undistortPixel, type Intrinsics, type Pose } from "../camera";
import { blur } from "./corners";
import {
  BOARD,
  BOARD_CENTER,
  BOARD_SIZE,
  LAB_PROJECTOR,
  LAB_STEREO,
  defocusSigma,
  exposureGain,
  type CaptureSettings,
} from "./rig";

/** Undistorted normalized coordinates at the pixel-corner grid (W+1)×(H+1). */
interface RayGrid {
  x: Float32Array;
  y: Float32Array;
}
const gridCache = new Map<string, RayGrid>();
function rayGrid(K: Intrinsics): RayGrid {
  const key = JSON.stringify(K);
  const hit = gridCache.get(key);
  if (hit) return hit;
  const W = K.width + 1,
    H = K.height + 1;
  const x = new Float32Array(W * H),
    y = new Float32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const [nx, ny] = undistortPixel(K, [i - 0.5, j - 0.5]);
      x[j * W + i] = nx;
      y[j * W + i] = ny;
    }
  const grid = { x, y };
  gridCache.set(key, grid);
  return grid;
}

export const scaleIntrinsics = (K: Intrinsics, s: number): Intrinsics => ({
  ...K,
  width: Math.round(K.width * s),
  height: Math.round(K.height * s),
  fx: K.fx * s,
  fy: K.fy * s,
  cx: (K.cx + 0.5) * s - 0.5,
  cy: (K.cy + 0.5) * s - 0.5,
});

/** Per-pixel scene terms shared by every pattern of one board pose (already lens-blurred). */
export interface SceneTerms {
  width: number;
  height: number;
  /** Radiance from room light. */
  ambient: Float32Array;
  /** Radiance under full projector white. */
  lit: Float32Array;
  /** Projector pixel seen by the pixel centre (NaN = not lit). */
  up: Float32Array;
  vp: Float32Array;
  /** Lens blur σ, px. */
  sigma: number;
}

const BACKGROUND = 0.05;
const BACKSIDE = 0.35;

function reflectance(qx: number, qy: number): number {
  if (
    qx < BOARD_SIZE.x0 ||
    qx > BOARD_SIZE.x1 ||
    qy < BOARD_SIZE.y0 ||
    qy > BOARD_SIZE.y1
  )
    return -1;
  const s = BOARD.square;
  const i = Math.floor(qx / s) + 1,
    j = Math.floor(qy / s) + 1;
  if (i < 0 || j < 0 || i > BOARD.cols || j > BOARD.rows) return BOARD.white;
  return (i + j) % 2 === 0 ? BOARD.black : BOARD.white;
}

/** Ray-trace the flat board through the distorted camera (ss×ss samples per pixel). */
export function sceneTerms(
  K: Intrinsics,
  pose: Pose,
  settings: CaptureSettings,
  ss = 2,
): SceneTerms {
  const grid = rayGrid(K);
  const W = K.width,
    H = K.height,
    GW = W + 1;
  const R = pose.R,
    t = pose.t;
  const n0 = R[0][2],
    n1 = R[1][2],
    n2 = R[2][2];
  const nt = n0 * t[0] + n1 * t[1] + n2 * t[2];
  const Rs = LAB_STEREO.R,
    Ts = LAB_STEREO.t;
  const projC: Vec3 = [
    -(Rs[0][0] * Ts[0] + Rs[1][0] * Ts[1] + Rs[2][0] * Ts[2]),
    -(Rs[0][1] * Ts[0] + Rs[1][1] * Ts[1] + Rs[2][1] * Ts[2]),
    -(Rs[0][2] * Ts[0] + Rs[1][2] * Ts[1] + Rs[2][2] * Ts[2]),
  ];
  const P = LAB_PROJECTOR;
  const amb = settings.ambient;
  const ambient = new Float32Array(W * H),
    lit = new Float32Array(W * H),
    up = new Float32Array(W * H).fill(NaN),
    vp = new Float32Array(W * H).fill(NaN);
  // Scratch outputs of `sample` (avoids per-sample allocations).
  let outA = 0,
    outL = 0,
    outU = NaN,
    outV = NaN;
  const sample = (x: number, y: number) => {
    outU = outV = NaN;
    outL = 0;
    const denom = n0 * x + n1 * y + n2;
    const s = Math.abs(denom) > 1e-12 ? nt / denom : -1;
    if (!(s > 0)) {
      outA = BACKGROUND * amb;
      return;
    }
    const X0 = x * s,
      X1 = y * s,
      X2 = s;
    const d0 = X0 - t[0],
      d1 = X1 - t[1],
      d2 = X2 - t[2];
    const qx = R[0][0] * d0 + R[1][0] * d1 + R[2][0] * d2;
    const qy = R[0][1] * d0 + R[1][1] * d1 + R[2][1] * d2;
    let rho = reflectance(qx, qy);
    if (rho < 0) {
      outA = BACKGROUND * amb;
      return;
    }
    // The printed face looks along −n; the camera sits at the origin.
    const front = X0 * n0 + X1 * n1 + X2 * n2 > 0;
    if (!front) rho = BACKSIDE;
    outA = rho * amb;
    const p0 = projC[0] - X0,
      p1 = projC[1] - X1,
      p2 = projC[2] - X2;
    const cosFront = -(p0 * n0 + p1 * n1 + p2 * n2) / Math.hypot(p0, p1, p2);
    const cosP = front ? cosFront : -cosFront;
    if (cosP <= 0) return;
    const c0 = Rs[0][0] * X0 + Rs[0][1] * X1 + Rs[0][2] * X2 + Ts[0],
      c1 = Rs[1][0] * X0 + Rs[1][1] * X1 + Rs[1][2] * X2 + Ts[1],
      c2 = Rs[2][0] * X0 + Rs[2][1] * X1 + Rs[2][2] * X2 + Ts[2];
    if (c2 <= 0) return;
    const [xd, yd] = distort(c0 / c2, c1 / c2, P.dist);
    const u = P.fx * xd + P.cx,
      v = P.fy * yd + P.cy;
    if (u < -0.5 || v < -0.5 || u > P.width - 0.5 || v > P.height - 0.5) return;
    outL = rho * cosP;
    outU = u;
    outV = v;
  };
  const inv = 1 / (ss * ss);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const g00 = j * GW + i,
        g10 = g00 + 1,
        g01 = g00 + GW,
        g11 = g01 + 1;
      const x00 = grid.x[g00],
        x10 = grid.x[g10],
        x01 = grid.x[g01],
        x11 = grid.x[g11];
      const y00 = grid.y[g00],
        y10 = grid.y[g10],
        y01 = grid.y[g01],
        y11 = grid.y[g11];
      let a = 0,
        l = 0;
      for (let b = 0; b < ss; b++) {
        const fv = (b + 0.5) / ss;
        for (let c = 0; c < ss; c++) {
          const fu = (c + 0.5) / ss;
          sample(
            (1 - fv) * ((1 - fu) * x00 + fu * x10) +
              fv * ((1 - fu) * x01 + fu * x11),
            (1 - fv) * ((1 - fu) * y00 + fu * y10) +
              fv * ((1 - fu) * y01 + fu * y11),
          );
          a += outA;
          l += outL;
        }
      }
      const idx = j * W + i;
      ambient[idx] = a * inv;
      lit[idx] = l * inv;
      sample(0.25 * (x00 + x10 + x01 + x11), 0.25 * (y00 + y10 + y01 + y11));
      up[idx] = outU;
      vp[idx] = outV;
    }
  const centre = mul3(R, BOARD_CENTER);
  const sigma =
    Math.hypot(defocusSigma(settings, centre[2] + t[2]), 0.5) * (K.fx / 1600);
  return {
    width: W,
    height: H,
    ambient: sigma < 0.3 ? ambient : blur(ambient, W, H, sigma),
    lit: sigma < 0.3 ? lit : blur(lit, W, H, sigma),
    up,
    vp,
    sigma,
  };
}

/** A projected pattern; null = full white. */
export type Pattern = null | {
  axis: "x" | "y";
  frequency: number;
  /** Phase shift δ, rad. */
  shift: number;
};

/**
 * Blurred radiance for one pattern. Fringes are smooth on the blur scale, so blur(lit·p) ≈ blur(lit)·p
 * with the fringe contrast reduced by the blur's transfer function.
 */
export function shade(terms: SceneTerms, pattern: Pattern): Float32Array {
  const out = new Float32Array(terms.ambient.length);
  if (!pattern) {
    for (let i = 0; i < out.length; i++)
      out[i] = terms.ambient[i] + terms.lit[i];
    return out;
  }
  const coords = pattern.axis === "x" ? terms.up : terms.vp;
  const span =
    pattern.axis === "x" ? LAB_PROJECTOR.width : LAB_PROJECTOR.height;
  const k = (2 * Math.PI * pattern.frequency) / span;
  const contrast = 0.5 * Math.exp(-((k * terms.sigma) ** 2) / 2);
  for (let i = 0; i < out.length; i++) {
    const c = coords[i];
    const p = c === c ? 0.5 + contrast * Math.cos(k * c + pattern.shift) : 0;
    out[i] = terms.ambient[i] + terms.lit[i] * p;
  }
  return out;
}

const NOISE_TABLE = (() => {
  let s = 0x9e3779b9;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let m = Math.imul(s ^ (s >>> 15), s | 1);
    m ^= m + Math.imul(m ^ (m >>> 7), m | 61);
    return ((m ^ (m >>> 14)) >>> 0) / 4294967296;
  };
  return Float32Array.from({ length: 1 << 16 }, () => gaussian(rnd));
})();

/** Exposure, shot + read noise, 8-bit quantisation and clipping. */
export function expose(
  radiance: Float32Array,
  settings: CaptureSettings,
  random: () => number,
): Uint8Array {
  const gain = exposureGain(settings);
  const read2 = settings.noiseDN ** 2;
  const out = new Uint8Array(radiance.length);
  let cursor = Math.floor(random() * NOISE_TABLE.length);
  // An odd stride visits the whole table before repeating.
  const stride = 1 + 2 * Math.floor(random() * 2000);
  for (let i = 0; i < out.length; i++) {
    const dn = gain * radiance[i];
    cursor = (cursor + stride) & 0xffff;
    const v =
      dn + Math.sqrt(read2 + (dn > 0 ? dn / 40 : 0)) * NOISE_TABLE[cursor];
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return out;
}

/** Fraction of the image clipped at 255. */
export function saturation(image: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < image.length; i++) if (image[i] === 255) n++;
  return n / image.length;
}
