import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

/** Achromatic surface: Lambert diffuse plus a GGX microfacet lobe. */
export interface SurfaceMaterial {
  /** Diffuse reflectance ρ in [0,1]. */
  albedo: number;
  /** Specular weight (constant Fresnel F0) in [0,1]; diffuse is scaled by 1−specular. */
  specular: number;
  /** Perceptual roughness; GGX α = roughness². */
  roughness: number;
}

/** Achromatic approximations; metals have no diffuse term and a strong specular lobe. */
export const MATERIAL_PRESETS: readonly ({
  id: string;
  name: string;
} & SurfaceMaterial)[] = [
  {
    id: "matte-white",
    name: "霧面白漆",
    albedo: 0.8,
    specular: 0,
    roughness: 0.3,
  },
  { id: "plaster", name: "石膏", albedo: 0.92, specular: 0, roughness: 0.9 },
  {
    id: "matte-floor",
    name: "灰色霧面地板",
    albedo: 0.5,
    specular: 0,
    roughness: 0.6,
  },
  {
    id: "concrete",
    name: "水泥",
    albedo: 0.35,
    specular: 0.02,
    roughness: 0.9,
  },
  {
    id: "wood",
    name: "亮漆木頭",
    albedo: 0.45,
    specular: 0.06,
    roughness: 0.35,
  },
  {
    id: "plastic",
    name: "亮面塑膠",
    albedo: 0.6,
    specular: 0.08,
    roughness: 0.2,
  },
  {
    id: "ceramic",
    name: "上釉陶瓷",
    albedo: 0.85,
    specular: 0.12,
    roughness: 0.08,
  },
  {
    id: "rubber",
    name: "黑色橡膠",
    albedo: 0.05,
    specular: 0.03,
    roughness: 0.7,
  },
  {
    id: "brushed-metal",
    name: "拉絲金屬",
    albedo: 0,
    specular: 0.85,
    roughness: 0.4,
  },
  {
    id: "polished-metal",
    name: "拋光金屬",
    albedo: 0,
    specular: 0.95,
    roughness: 0.1,
  },
  { id: "mirror", name: "鏡面", albedo: 0, specular: 1, roughness: 0.05 },
  {
    id: "solder-mask",
    name: "PCB 綠漆",
    albedo: 0.25,
    specular: 0.06,
    roughness: 0.3,
  },
  {
    id: "epoxy",
    name: "黑色環氧樹脂",
    albedo: 0.06,
    specular: 0.04,
    roughness: 0.5,
  },
  {
    id: "tin-lead",
    name: "鍍錫引腳",
    albedo: 0,
    specular: 0.8,
    roughness: 0.35,
  },
];

export interface SurfaceHit {
  point: THREE.Vector3;
  /** Geometric face normal from the triangle winding (outward for closed meshes). */
  normal: THREE.Vector3;
  /** Material slot: mesh index, or the per-vertex "surface" attribute when present. */
  mesh: number;
  /** Per-vertex "pinId" attribute, −1 when absent. */
  pin: number;
  distance: number;
}

export interface TraceScene {
  trace: (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    near?: number,
    far?: number,
  ) => SurfaceHit | null;
  dispose: () => void;
}

/** Flatten meshes into one world-space BVH; the caller keeps ownership of the meshes. */
export function buildTraceScene(meshes: THREE.Mesh[]): TraceScene {
  const parts = meshes.map((mesh) => {
    mesh.updateWorldMatrix(true, false);
    const source = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    const position = source.getAttribute("position").clone();
    position.applyMatrix4(mesh.matrixWorld);
    const surface = source.getAttribute("surface"),
      pinId = source.getAttribute("pinId");
    source.dispose();
    return { position, surface, pinId };
  });
  const vertexCount = parts.reduce((sum, p) => sum + p.position.count, 0);
  const positions = new Float32Array(vertexCount * 3);
  const owner = new Uint8Array(vertexCount);
  const pinOf = new Int16Array(vertexCount).fill(-1);
  let offset = 0;
  parts.forEach(({ position, surface, pinId }, meshIndex) => {
    for (let i = 0; i < position.count; i++) {
      positions.set(
        [position.getX(i), position.getY(i), position.getZ(i)],
        3 * offset,
      );
      // Per-vertex "surface" overrides the mesh index as material slot.
      owner[offset] = surface ? surface.getX(i) : meshIndex;
      if (pinId) pinOf[offset] = pinId.getX(i);
      offset++;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geometry);
  const ray = new THREE.Ray();
  return {
    trace: (origin, direction, near = 0, far = Infinity) => {
      ray.origin.copy(origin);
      ray.direction.copy(direction);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, near, far);
      if (!hit || !hit.face) return null;
      return {
        point: hit.point,
        normal: hit.face.normal,
        mesh: owner[hit.face.a],
        pin: pinOf[hit.face.a],
        distance: hit.distance,
      };
    },
    dispose: () => geometry.dispose(),
  };
}

const alphaSquared = (m: SurfaceMaterial) => Math.max(m.roughness ** 4, 1e-6);
const smithG1 = (cos: number, a2: number) =>
  (2 * cos) / (cos + Math.sqrt(a2 + (1 - a2) * cos * cos));
const ggxD = (cosH: number, a2: number) => {
  const t = cosH * cosH * (a2 - 1) + 1;
  return a2 / (Math.PI * t * t);
};
const half = new THREE.Vector3();

/** BRDF value f(wi, wo) in 1/sr; wi and wo point away from the surface. */
export function evaluateBrdf(
  m: SurfaceMaterial,
  n: THREE.Vector3,
  wi: THREE.Vector3,
  wo: THREE.Vector3,
): number {
  const cosI = n.dot(wi),
    cosO = n.dot(wo);
  if (cosI <= 0 || cosO <= 0) return 0;
  const diffuse = ((1 - m.specular) * m.albedo) / Math.PI;
  if (m.specular === 0) return diffuse;
  const a2 = alphaSquared(m);
  const cosH = half.addVectors(wi, wo).normalize().dot(n);
  return (
    diffuse +
    (m.specular * ggxD(cosH, a2) * smithG1(cosI, a2) * smithG1(cosO, a2)) /
      (4 * cosI * cosO)
  );
}

/** Probability of choosing the GGX lobe when importance sampling. */
export function specularProbability(m: SurfaceMaterial): number {
  if (m.specular === 0) return 0;
  const diffuse = (1 - m.specular) * m.albedo;
  if (diffuse === 0) return 1;
  return Math.min(0.9, Math.max(0.1, m.specular / (m.specular + diffuse)));
}

const tangent = new THREE.Vector3(),
  bitangent = new THREE.Vector3(),
  sampled = new THREE.Vector3();
function basis(n: THREE.Vector3) {
  // Duff et al. 2017, branchless orthonormal basis.
  const sign = n.z >= 0 ? 1 : -1,
    a = -1 / (sign + n.z),
    b = n.x * n.y * a;
  tangent.set(1 + sign * n.x * n.x * a, sign * b, -sign * n.x);
  bitangent.set(b, sign + n.y * n.y * a, -n.y);
}
const toWorld = (
  n: THREE.Vector3,
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3,
) =>
  out
    .copy(tangent)
    .multiplyScalar(x)
    .addScaledVector(bitangent, y)
    .addScaledVector(n, z);

/**
 * Sample wi from a diffuse/GGX mixture and return f·cos/pdf (0 when the sample
 * falls below the surface). The estimator is unbiased for the mixture pdf.
 */
export function sampleBrdf(
  m: SurfaceMaterial,
  n: THREE.Vector3,
  wo: THREE.Vector3,
  random: () => number,
  wi: THREE.Vector3,
): number {
  const ps = specularProbability(m),
    a2 = alphaSquared(m);
  basis(n);
  const u1 = random(),
    u2 = random(),
    phi = 2 * Math.PI * u2;
  if (random() < ps) {
    const cos = Math.sqrt((1 - u1) / (1 + (a2 - 1) * u1)),
      sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    toWorld(n, sin * Math.cos(phi), sin * Math.sin(phi), cos, sampled);
    wi.copy(sampled)
      .multiplyScalar(2 * wo.dot(sampled))
      .sub(wo);
  } else {
    const r = Math.sqrt(u1);
    toWorld(n, r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u1), wi);
  }
  wi.normalize();
  const cosI = n.dot(wi);
  if (cosI <= 0 || n.dot(wo) <= 0) return 0;
  let pdf = ((1 - ps) * cosI) / Math.PI;
  if (ps > 0) {
    half.addVectors(wi, wo).normalize();
    pdf += (ps * ggxD(half.dot(n), a2) * half.dot(n)) / (4 * wo.dot(half));
  }
  return pdf > 0 ? (evaluateBrdf(m, n, wi, wo) * cosI) / pdf : 0;
}
