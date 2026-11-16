export type Vec3 = [number, number, number];
export type Mat = number[][];

export const identity3 = (): Mat => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const transpose = (a: Mat): Mat =>
  a[0].map((_, j) => a.map((row) => row[j]));
export const matMul = (a: Mat, b: Mat): Mat =>
  a.map((row) =>
    b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)),
  );
export const matVec = (a: Mat, v: readonly number[]): number[] =>
  a.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
export const mul3 = (a: Mat, v: readonly number[]): Vec3 => [
  a[0][0] * v[0] + a[0][1] * v[1] + a[0][2] * v[2],
  a[1][0] * v[0] + a[1][1] * v[1] + a[1][2] * v[2],
  a[2][0] * v[0] + a[2][1] * v[1] + a[2][2] * v[2],
];
export const add3 = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub3 = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale3 = (a: readonly number[], s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
export const dot3 = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm3 = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
export const normalize3 = (a: readonly number[]): Vec3 =>
  scale3(a, 1 / norm3(a));

/** Symmetric eigen-decomposition (cyclic Jacobi); eigenvalues ascending, vectors[k] pairs with values[k]. */
export function symmetricEigen(input: Mat): {
  values: number[];
  vectors: number[][];
} {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v: Mat = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p],
            vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = a.map((_, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

/** Unit vector x minimising |A x| (least-squares null vector). */
export function nullVector(rows: readonly number[][]): number[] {
  const n = rows[0].length;
  const ata: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of rows)
    for (let i = 0; i < n; i++)
      for (let j = i; j < n; j++) ata[i][j] += r[i] * r[j];
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) ata[i][j] = ata[j][i];
  return symmetricEigen(ata).vectors[0];
}

/** Gaussian elimination with partial pivoting; null when (near) singular. */
export function solveLinear(a: Mat, b: readonly number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (!(Math.abs(m[pivot][c]) > 1e-300)) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

export function invert3(a: Mat): Mat | null {
  const cols = [0, 1, 2].map((j) =>
    solveLinear(
      a,
      [0, 1, 2].map((i) => (i === j ? 1 : 0)),
    ),
  );
  if (cols.some((c) => !c)) return null;
  return [0, 1, 2].map((i) => cols.map((c) => c![i]));
}

/** Rotation vector (axis × angle, rad) → matrix, as cv.Rodrigues. */
export function rodrigues(r: readonly number[]): Mat {
  const theta = norm3(r);
  if (theta < 1e-12)
    return [
      [1, -r[2], r[1]],
      [r[2], 1, -r[0]],
      [-r[1], r[0], 1],
    ];
  const [x, y, z] = scale3(r, 1 / theta);
  const c = Math.cos(theta),
    s = Math.sin(theta),
    C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

function quaternionToMatrix([w, x, y, z]: readonly number[]): Mat {
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
}

/** Matrix → rotation vector; R is assumed orthonormal. */
export function rotationToVector(R: Mat): Vec3 {
  // Shepperd's method keeps the quaternion well conditioned near 180°.
  const tr = R[0][0] + R[1][1] + R[2][2];
  let w: number, x: number, y: number, z: number;
  if (tr > Math.max(R[0][0], R[1][1], R[2][2])) {
    w = Math.sqrt(1 + tr) / 2;
    x = (R[2][1] - R[1][2]) / (4 * w);
    y = (R[0][2] - R[2][0]) / (4 * w);
    z = (R[1][0] - R[0][1]) / (4 * w);
  } else if (R[0][0] >= R[1][1] && R[0][0] >= R[2][2]) {
    x = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) / 2;
    w = (R[2][1] - R[1][2]) / (4 * x);
    y = (R[0][1] + R[1][0]) / (4 * x);
    z = (R[0][2] + R[2][0]) / (4 * x);
  } else if (R[1][1] >= R[2][2]) {
    y = Math.sqrt(1 - R[0][0] + R[1][1] - R[2][2]) / 2;
    w = (R[0][2] - R[2][0]) / (4 * y);
    x = (R[0][1] + R[1][0]) / (4 * y);
    z = (R[1][2] + R[2][1]) / (4 * y);
  } else {
    z = Math.sqrt(1 - R[0][0] - R[1][1] + R[2][2]) / 2;
    w = (R[1][0] - R[0][1]) / (4 * z);
    x = (R[0][2] + R[2][0]) / (4 * z);
    y = (R[1][2] + R[2][1]) / (4 * z);
  }
  if (w < 0) [w, x, y, z] = [-w, -x, -y, -z];
  const s = Math.hypot(x, y, z);
  if (s < 1e-15) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, w);
  return [(x / s) * angle, (y / s) * angle, (z / s) * angle];
}

/** Horn's quaternion method: rotation maximising Σ bᵢ·(R aᵢ), given S = Σ aᵢ bᵢᵀ. */
function hornRotation(S: Mat): Mat {
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N: Mat = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  return quaternionToMatrix(symmetricEigen(N).vectors[3]);
}

/** Closest rotation to M in the Frobenius sense. */
export const nearestRotation = (M: Mat): Mat => hornRotation(transpose(M));

/** Angle of the relative rotation between two rotation matrices, degrees. */
export function rotationAngleDeg(a: Mat, b: Mat): number {
  return (norm3(rotationToVector(matMul(a, transpose(b)))) * 180) / Math.PI;
}

/** Kabsch / Horn: R, t with R·src + t ≈ dst (least squares). */
export function rigidTransform(
  src: readonly Vec3[],
  dst: readonly Vec3[],
): { R: Mat; t: Vec3; rms: number } {
  if (src.length !== dst.length || src.length < 3)
    throw new RangeError("Need at least 3 corresponding points");
  const mean = (p: readonly Vec3[]) =>
    scale3(
      p.reduce<Vec3>((s, v) => add3(s, v), [0, 0, 0]),
      1 / p.length,
    );
  const ca = mean(src),
    cb = mean(dst);
  const S: Mat = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  src.forEach((s, k) => {
    const a = sub3(s, ca),
      b = sub3(dst[k], cb);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) S[i][j] += a[i] * b[j];
  });
  const R = hornRotation(S);
  const t = sub3(cb, mul3(R, ca));
  const rms = Math.sqrt(
    src.reduce((s, p, k) => {
      const d = sub3(add3(mul3(R, p), t), dst[k]);
      return s + dot3(d, d);
    }, 0) / src.length,
  );
  return { R, t, rms };
}

/** Standard normal sample from a uniform source (Box–Muller). */
export function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-300);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
