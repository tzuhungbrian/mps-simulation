import type { Point2 } from "../camera";

/** Separable Gaussian blur on a float image. */
export function blur(
  img: Float32Array,
  W: number,
  H: number,
  sigma: number,
): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++)
    sum += kernel[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(img.length),
    out = new Float32Array(img.length);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k < 0 ? 0 : x + k >= W ? W - 1 : x + k;
        s += kernel[k + r] * img[row + xx];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k < 0 ? 0 : y + k >= H ? H - 1 : y + k;
        s += kernel[k + r] * tmp[yy * W + x];
      }
      out[y * W + x] = s;
    }
  return out;
}

function bilinear(
  img: ArrayLike<number>,
  W: number,
  H: number,
  x: number,
  y: number,
): number {
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))),
    y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0)),
    fy = Math.max(0, Math.min(1, y - y0));
  const i = y0 * W + x0;
  return (
    (1 - fy) * ((1 - fx) * img[i] + fx * img[i + 1]) +
    fy * ((1 - fx) * img[i + W] + fx * img[i + W + 1])
  );
}

interface Candidate {
  x: number;
  y: number;
  r: number;
}

/** X-junctions: positive −det(Hessian) maxima whose surrounding ring alternates dark/bright four times. */
function saddleCandidates(g: Float32Array, W: number, H: number): Candidate[] {
  const s = 2;
  const resp = new Float32Array(W * H);
  for (let y = s; y < H - s; y++)
    for (let x = s; x < W - s; x++) {
      const i = y * W + x;
      const ixx = g[i + s] - 2 * g[i] + g[i - s];
      const iyy = g[i + s * W] - 2 * g[i] + g[i - s * W];
      const ixy =
        (g[i + s * W + s] -
          g[i + s * W - s] -
          g[i - s * W + s] +
          g[i - s * W - s]) /
        4;
      resp[i] = ixy * ixy - ixx * iyy;
    }
  const found: Candidate[] = [];
  const m = 6;
  for (let y = m; y < H - m; y++)
    for (let x = m; x < W - m; x++) {
      const v = resp[y * W + x];
      if (!(v > 0)) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if ((dx || dy) && resp[(y + dy) * W + x + dx] > v) {
            isMax = false;
            break;
          }
        }
      if (isMax) found.push({ x, y, r: v });
    }
  if (found.length < 10) return found;
  found.sort((a, b) => b.r - a.r);
  const ref = found[10].r;
  const ring = 32,
    radius = 5;
  return found
    .filter((c) => c.r >= 0.08 * ref)
    .slice(0, 600)
    .filter((c) => {
      const values: number[] = [];
      for (let k = 0; k < ring; k++) {
        const a = (2 * Math.PI * k) / ring;
        values.push(
          bilinear(
            g,
            W,
            H,
            c.x + radius * Math.cos(a),
            c.y + radius * Math.sin(a),
          ),
        );
      }
      const mean = values.reduce((p, q) => p + q, 0) / ring;
      const spread = Math.max(...values) - Math.min(...values);
      if (spread < 8) return false;
      let changes = 0;
      for (let k = 0; k < ring; k++)
        if (values[k] - mean > 0 !== values[(k + 1) % ring] - mean > 0)
          changes++;
      return changes === 4;
    });
}

type V2 = [number, number];

/** Recover the cols×rows grid by growing from a central X-junction. */
function growGrid(
  cands: Candidate[],
  cols: number,
  rows: number,
): Point2[] | null {
  if (cands.length < cols * rows) return null;
  const pts = cands.map((c): V2 => [c.x, c.y]);
  const mx = [...pts].map((p) => p[0]).sort((a, b) => a - b)[pts.length >> 1];
  const my = [...pts].map((p) => p[1]).sort((a, b) => a - b)[pts.length >> 1];
  let seed = 0;
  pts.forEach((p, i) => {
    if (
      Math.hypot(p[0] - mx, p[1] - my) <
      Math.hypot(pts[seed][0] - mx, pts[seed][1] - my)
    )
      seed = i;
  });
  const near = pts
    .map((p, i) => ({
      i,
      d: Math.hypot(p[0] - pts[seed][0], p[1] - pts[seed][1]),
    }))
    .filter((e) => e.i !== seed)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  if (near.length < 2) return null;
  const b1: V2 = [
    pts[near[0].i][0] - pts[seed][0],
    pts[near[0].i][1] - pts[seed][1],
  ];
  const second = near.find((e) => {
    const v: V2 = [pts[e.i][0] - pts[seed][0], pts[e.i][1] - pts[seed][1]];
    const cos =
      (v[0] * b1[0] + v[1] * b1[1]) / (Math.hypot(...v) * Math.hypot(...b1));
    return Math.abs(cos) < 0.6;
  });
  if (!second) return null;
  const b2: V2 = [
    pts[second.i][0] - pts[seed][0],
    pts[second.i][1] - pts[seed][1],
  ];

  const cell = new Map<string, { idx: number; b1: V2; b2: V2 }>();
  const used = new Set<number>([seed]);
  const key = (i: number, j: number) => `${i},${j}`;
  cell.set(key(0, 0), { idx: seed, b1, b2 });
  const queue: [number, number][] = [[0, 0]];
  while (queue.length) {
    const [i, j] = queue.shift()!;
    const c = cell.get(key(i, j))!;
    const p = pts[c.idx];
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (cell.has(key(i + di, j + dj))) continue;
      const step: V2 = [
        di * c.b1[0] + dj * c.b2[0],
        di * c.b1[1] + dj * c.b2[1],
      ];
      const pred: V2 = [p[0] + step[0], p[1] + step[1]];
      const tol = 0.3 * Math.hypot(...step);
      let best = -1,
        bestD = tol;
      pts.forEach((q, k) => {
        if (used.has(k)) return;
        const d = Math.hypot(q[0] - pred[0], q[1] - pred[1]);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best < 0) continue;
      const actual: V2 = [
        (pts[best][0] - p[0]) * (di || dj),
        (pts[best][1] - p[1]) * (di || dj),
      ];
      used.add(best);
      cell.set(key(i + di, j + dj), {
        idx: best,
        b1: di ? actual : c.b1,
        b2: dj ? actual : c.b2,
      });
      queue.push([i + di, j + dj]);
    }
  }
  const ij = [...cell.keys()].map((k) => k.split(",").map(Number) as V2);
  const iMin = Math.min(...ij.map((v) => v[0])),
    iMax = Math.max(...ij.map((v) => v[0])),
    jMin = Math.min(...ij.map((v) => v[1])),
    jMax = Math.max(...ij.map((v) => v[1]));
  const ni = iMax - iMin + 1,
    nj = jMax - jMin + 1;
  if (cell.size !== cols * rows || ni * nj !== cols * rows) return null;
  let swap: boolean;
  if (ni === cols && nj === rows) swap = false;
  else if (ni === rows && nj === cols) swap = true;
  else return null;
  const at = (c: number, r: number): V2 => {
    const [i, j] = swap ? [iMin + r, jMin + c] : [iMin + c, jMin + r];
    return pts[cell.get(key(i, j))!.idx];
  };
  const out: Point2[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push([...at(c, r)]);
  // Keep a right-handed labelling in the image (column step × row step > 0, y down).
  const ex: V2 = [out[1][0] - out[0][0], out[1][1] - out[0][1]];
  const ey: V2 = [out[cols][0] - out[0][0], out[cols][1] - out[0][1]];
  if (ex[0] * ey[1] - ex[1] * ey[0] < 0) {
    const flipped: Point2[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        flipped.push(out[r * cols + (cols - 1 - c)]);
    return flipped;
  }
  return out;
}

/** Iterative sub-pixel refinement, same idea as cv.cornerSubPix: gradients in the window are ⊥ to (p − q). */
export function cornerSubPix(
  img: ArrayLike<number>,
  W: number,
  H: number,
  corners: Point2[],
  win = 5,
  maxIter = 30,
  eps = 0.01,
): Point2[] {
  const weights: number[] = [];
  for (let dy = -win; dy <= win; dy++)
    for (let dx = -win; dx <= win; dx++)
      weights.push(Math.exp(-(dx * dx + dy * dy) / (2 * (win / 2) ** 2)));
  return corners.map(([x0, y0]) => {
    let cx = x0,
      cy = y0;
    for (let it = 0; it < maxIter; it++) {
      let a = 0,
        b = 0,
        c = 0,
        bb1 = 0,
        bb2 = 0,
        k = 0;
      for (let dy = -win; dy <= win; dy++)
        for (let dx = -win; dx <= win; dx++, k++) {
          const px = cx + dx,
            py = cy + dy;
          const gx =
            (bilinear(img, W, H, px + 1, py) -
              bilinear(img, W, H, px - 1, py)) /
            2;
          const gy =
            (bilinear(img, W, H, px, py + 1) -
              bilinear(img, W, H, px, py - 1)) /
            2;
          const w = weights[k];
          const gxx = gx * gx * w,
            gxy = gx * gy * w,
            gyy = gy * gy * w;
          a += gxx;
          b += gxy;
          c += gyy;
          bb1 += gxx * px + gxy * py;
          bb2 += gxy * px + gyy * py;
        }
      const det = a * c - b * b;
      if (Math.abs(det) < 1e-9) break;
      const nx = (c * bb1 - b * bb2) / det,
        ny = (a * bb2 - b * bb1) / det;
      const shift = Math.hypot(nx - cx, ny - cy);
      cx = nx;
      cy = ny;
      if (shift < eps) break;
    }
    return [cx, cy];
  });
}

/** Chessboard inner-corner detection (stand-in for cv.findChessboardCorners, which opencv.js lacks). */
export function findChessboardCorners(
  gray: Uint8Array,
  W: number,
  H: number,
  cols: number,
  rows: number,
): Point2[] | null {
  const f = Float32Array.from(gray);
  const g = blur(f, W, H, 2);
  const grid = growGrid(saddleCandidates(g, W, H), cols, rows);
  if (!grid) return null;
  const refined = cornerSubPix(f, W, H, grid);
  return refined.every(
    (p, i) => Math.hypot(p[0] - grid[i][0], p[1] - grid[i][1]) < 4,
  )
    ? refined
    : null;
}
