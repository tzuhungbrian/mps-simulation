import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Material slot carried per vertex; object and ground keep their mesh index. */
export const SURFACE = { object: 0, ground: 1, chip: 2, pin: 3 } as const;
export const SURFACE_NAMES = ["物體", "地面", "晶片本體", "引腳"] as const;

export interface PcbPin {
  id: number;
  label: string;
  component: string;
}

const BOARD = { x: 1.6, y: 0.08, z: 1.2 };
const TOP = BOARD.y / 2;
export const PCB_BOARD_TOP = TOP;
const PIN_T = 0.012,
  PIN_W = 0.022;

/** Scaled-up PCB (1.6 × 0.08 × 1.2) with QFP, SOIC, header and passives, centred at the origin. */
export function buildPcbGeometry(): {
  geometry: THREE.BufferGeometry;
  pins: PcbPin[];
} {
  const parts: THREE.BufferGeometry[] = [];
  const pins: PcbPin[] = [];
  const box = (
    center: [number, number, number],
    size: [number, number, number],
    surface: number,
    pin = -1,
  ) => {
    const g = new THREE.BoxGeometry(...size);
    g.translate(...center);
    const n = g.getAttribute("position").count;
    g.setAttribute(
      "surface",
      new THREE.BufferAttribute(new Float32Array(n).fill(surface), 1),
    );
    g.setAttribute(
      "pinId",
      new THREE.BufferAttribute(new Float32Array(n).fill(pin), 1),
    );
    parts.push(g);
  };
  const newPin = (component: string, index: number) => {
    const id = pins.length;
    pins.push({ id, label: `${component}-${index}`, component });
    return id;
  };
  /** Gull-wing lead: shoulder out of the body, vertical drop, foot on the board. */
  const gullWing = (
    pin: number,
    origin: [number, number],
    outward: [number, number],
    shoulderY: number,
  ) => {
    const along = (d: number): [number, number] => [
      origin[0] + outward[0] * d,
      origin[1] + outward[1] * d,
    ];
    const size = (length: number, height: number): [number, number, number] =>
      outward[0] !== 0 ? [length, height, PIN_W] : [PIN_W, height, length];
    const shoulder = along(0.0125),
      drop = along(0.025 + PIN_T / 2),
      foot = along(0.045);
    box(
      [shoulder[0], shoulderY, shoulder[1]],
      size(0.025, PIN_T),
      SURFACE.pin,
      pin,
    );
    box(
      [drop[0], (TOP + shoulderY) / 2, drop[1]],
      size(PIN_T, shoulderY - TOP + PIN_T),
      SURFACE.pin,
      pin,
    );
    box(
      [foot[0], TOP + PIN_T / 2, foot[1]],
      size(0.04, PIN_T),
      SURFACE.pin,
      pin,
    );
  };

  box([0, 0, 0], [BOARD.x, BOARD.y, BOARD.z], SURFACE.object);

  // U1: QFP, 6 leads per side.
  const qfp = { x: -0.35, z: -0.2, half: 0.17, h: 0.06 };
  box([qfp.x, TOP + qfp.h / 2, qfp.z], [0.34, qfp.h, 0.34], SURFACE.chip);
  const sides: [number, number][] = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (const [ox, oz] of sides)
    for (let i = 0; i < 6; i++) {
      const s = (i - 2.5) * 0.05;
      gullWing(
        newPin("U1", pins.filter((p) => p.component === "U1").length + 1),
        [
          qfp.x + ox * qfp.half + (ox === 0 ? s : 0),
          qfp.z + oz * qfp.half + (oz === 0 ? s : 0),
        ],
        [ox, oz],
        TOP + qfp.h / 2,
      );
    }

  // U2: SOIC, 5 leads on each long side.
  const soic = { x: 0.35, z: -0.3, halfZ: 0.08, h: 0.05 };
  box([soic.x, TOP + soic.h / 2, soic.z], [0.32, soic.h, 0.16], SURFACE.chip);
  for (const oz of [1, -1])
    for (let i = 0; i < 5; i++)
      gullWing(
        newPin("U2", pins.filter((p) => p.component === "U2").length + 1),
        [soic.x + (i - 2) * 0.06, soic.z + oz * soic.halfZ],
        [0, oz],
        TOP + soic.h / 2,
      );

  // J1: 2×4 pin header with vertical posts through a plastic base.
  box([0.35, TOP + 0.025, 0.25], [0.26, 0.05, 0.12], SURFACE.chip);
  for (const dz of [-0.03, 0.03])
    for (let i = 0; i < 4; i++)
      box(
        [0.35 + (i - 1.5) * 0.06, TOP + 0.08, 0.25 + dz],
        [PIN_W, 0.16, PIN_W],
        SURFACE.pin,
        newPin("J1", pins.filter((p) => p.component === "J1").length + 1),
      );

  // R1, C1, C2: chip passives with metal end terminals.
  for (const [name, x, z] of [
    ["R1", -0.45, 0.3],
    ["C1", -0.2, 0.3],
    ["C2", -0.2, 0.45],
  ] as const) {
    box([x, TOP + 0.02, z], [0.08, 0.04, 0.045], SURFACE.chip);
    for (const [index, side] of [
      [1, -1],
      [2, 1],
    ] as const)
      box(
        [x + side * 0.0525, TOP + 0.021, z],
        [0.025, 0.042, 0.047],
        SURFACE.pin,
        newPin(name, index),
      );
  }

  const geometry = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return { geometry, pins };
}

/** Deterministic pin table for reports, built once from the same geometry routine. */
export const PCB_PINS: readonly PcbPin[] = (() => {
  const { geometry, pins } = buildPcbGeometry();
  geometry.dispose();
  return pins;
})();
