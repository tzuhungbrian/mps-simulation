import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SURFACE } from "./pcb";

/** Uniform attributes so every part can be merged into one object mesh. */
function prepare(geometry: THREE.BufferGeometry, slot: number) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  for (const name of Object.keys(g.attributes))
    if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  const n = g.getAttribute("position").count;
  g.setAttribute(
    "surface",
    new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1),
  );
  g.setAttribute(
    "pinId",
    new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1),
  );
  g.clearGroups();
  return g;
}

function boxAt(
  center: [number, number, number],
  size: [number, number, number],
  slot: number,
) {
  const g = new THREE.BoxGeometry(...size);
  g.translate(...center);
  return prepare(g, slot);
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

/** 2012 chip along local x with metal end caps and two solder fillets. */
function chipParts(center: [number, number], rotation: number) {
  const length = 2,
    width = 1.25,
    height = 0.6,
    cap = 0.4;
  const parts = [
    boxAt([0, height / 2, 0], [length - 2 * cap, height, width], SURFACE.chip),
    boxAt(
      [-(length - cap) / 2, height / 2, 0],
      [cap, height, width],
      SURFACE.pin,
    ),
    boxAt(
      [(length - cap) / 2, height / 2, 0],
      [cap, height, width],
      SURFACE.pin,
    ),
  ];
  for (const side of [1, -1]) {
    const g = filletGeometry(0.5, 0.35, width);
    if (side < 0) g.rotateY(Math.PI);
    g.translate((side * length) / 2, 0, 0);
    parts.push(prepare(g, SURFACE.solder));
  }
  for (const g of parts) {
    g.rotateY(rotation);
    g.translate(center[0], 0, center[1]);
  }
  return parts;
}

export const STEP_HEIGHTS = [0.1, 0.3, 0.6, 1.0, 1.6, 2.4] as const;
/** Board footprint of the AOI test scenes, mm. */
export const BOARD_SIZE = 60;

/**
 * AOI test pieces in mm with the board top at local y = 0, centred on the origin:
 * a step gauge, two 2012 chips with fillets plus a 3 mm tall part, or a bare plane.
 */
export function buildBoardScene(
  kind: "step" | "chip" | "plane",
): THREE.BufferGeometry {
  const parts = [
    boxAt([0, -0.5, 0], [BOARD_SIZE, 1, BOARD_SIZE], SURFACE.object),
  ];
  if (kind === "step")
    STEP_HEIGHTS.forEach((h, i) =>
      parts.push(
        boxAt(
          [(i % 3) * 2.4 - 2.4, h / 2, i < 3 ? -1.3 : 1.3],
          [1.4, h, 1.4],
          SURFACE.chip,
        ),
      ),
    );
  else if (kind === "chip")
    parts.push(
      ...chipParts([-1.8, -1.3], 0),
      ...chipParts([-1.0, 1.4], Math.PI / 2),
      boxAt([2.2, 1.5, 0], [1.6, 3, 1.6], SURFACE.chip),
    );
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}
