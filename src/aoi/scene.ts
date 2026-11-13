import * as THREE from "three";
import { buildPcbGeometry, PCB_BOARD_TOP, SURFACE } from "../sandbox/pcb";
import type { AoiConfig, PcbRegion } from "./rig";

/** Material slot per surface; indexes AoiConfig.materials in MATERIAL_SLOTS order. */
export const SLOT = { board: 0, body: 1, metal: 2, solder: 3 } as const;
export const NO_SURFACE = 255;

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

function tag(geometry: THREE.BufferGeometry, slot: number) {
  const n = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "surface",
    new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1),
  );
  return geometry;
}

function boxAt(
  center: [number, number, number],
  size: [number, number, number],
  slot: number,
) {
  const g = new THREE.BoxGeometry(...size);
  g.translate(...center);
  return tag(g, slot);
}

/** Concave solder fillet: height h·(1 − s/L)² from the electrode face (s = 0) to the toe (s = L). */
function filletGeometry(length: number, height: number, width: number) {
  const points = [new THREE.Vector2(0, 0), new THREE.Vector2(length, 0)];
  const steps = 10;
  for (let i = steps - 1; i >= 0; i--) {
    const s = (length * i) / steps;
    points.push(new THREE.Vector2(s, height * (1 - s / length) ** 2));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points), {
    depth: width,
    bevelEnabled: false,
  });
  g.translate(0, 0, -width / 2);
  return g;
}

/** Chip component (e.g. 2012) along local x, with metal end caps and two solder fillets. */
function chipGeometries(
  center: [number, number],
  rotation: number,
  size = { length: 2, width: 1.25, height: 0.6, cap: 0.4 },
  fillet = { length: 0.5, height: 0.35 },
) {
  const { length, width, height, cap } = size;
  const parts = [
    boxAt([0, height / 2, 0], [length - 2 * cap, height, width], SLOT.body),
    boxAt(
      [-(length - cap) / 2, height / 2, 0],
      [cap, height, width],
      SLOT.metal,
    ),
    boxAt(
      [(length - cap) / 2, height / 2, 0],
      [cap, height, width],
      SLOT.metal,
    ),
  ];
  for (const side of [1, -1]) {
    const g = filletGeometry(fillet.length, fillet.height, width);
    if (side < 0) g.rotateY(Math.PI);
    g.translate((side * length) / 2, 0, 0);
    parts.push(tag(g, SLOT.solder));
  }
  for (const g of parts) {
    g.rotateY(rotation);
    g.translate(center[0], 0, center[1]);
  }
  return parts;
}

export const STEP_HEIGHTS = [0.1, 0.3, 0.6, 1.0, 1.6, 2.4] as const;

/** ROI centres of the reused sandbox PCB, in sandbox units (1 unit = 25 mm here). */
const PCB_REGION_CENTERS: Record<PcbRegion, [number, number]> = {
  passives: [-0.325, 0.375],
  qfp: [-0.35, -0.08],
  header: [0.35, 0.25],
};
export const PCB_SCALE = 25;

function pcbGeometry(region: PcbRegion) {
  const { geometry } = buildPcbGeometry();
  const surface = geometry.getAttribute("surface") as THREE.BufferAttribute;
  // Sandbox slots (board, chip, pin) → AOI slots (board, body, metal).
  for (let i = 0; i < surface.count; i++) {
    const s = surface.getX(i);
    surface.setX(
      i,
      s === SURFACE.chip
        ? SLOT.body
        : s === SURFACE.pin
          ? SLOT.metal
          : SLOT.board,
    );
  }
  const [cx, cz] = PCB_REGION_CENTERS[region];
  geometry.translate(-cx, -PCB_BOARD_TOP, -cz);
  geometry.scale(PCB_SCALE, PCB_SCALE, PCB_SCALE);
  return geometry;
}

/** AOI scene in millimetres with the board (reference plane) top at height 0. */
export function buildAoiScene(
  config: Pick<AoiConfig, "scene" | "pcbRegion" | "planeHeight">,
): { meshes: Mesh[]; dispose: () => void } {
  const geometries: THREE.BufferGeometry[] = [];
  if (config.scene === "pcb") geometries.push(pcbGeometry(config.pcbRegion));
  else if (config.scene === "plane")
    geometries.push(
      boxAt([0, config.planeHeight - 0.5, 0], [60, 1, 60], SLOT.board),
    );
  else {
    geometries.push(boxAt([0, -0.5, 0], [60, 1, 60], SLOT.board));
    if (config.scene === "step")
      STEP_HEIGHTS.forEach((h, i) =>
        geometries.push(
          boxAt(
            [(i % 3) * 2.4 - 2.4, h / 2, i < 3 ? -1.3 : 1.3],
            [1.4, h, 1.4],
            SLOT.body,
          ),
        ),
      );
    else {
      geometries.push(
        ...chipGeometries([-1.8, -1.3], 0),
        ...chipGeometries([-1.0, 1.4], Math.PI / 2),
        boxAt([2.2, 1.5, 0], [1.6, 3, 1.6], SLOT.body),
      );
    }
  }
  const material = new THREE.MeshBasicMaterial({ color: 0x8aa0b4 });
  const meshes = geometries.map((g) => new THREE.Mesh(g, material) as Mesh);
  return {
    meshes,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
