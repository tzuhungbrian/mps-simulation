import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { applyPose, invertPose, type Intrinsics, type Pose } from "../camera";
import type { Vec3 } from "../linalg";
import {
  BOARD,
  BOARD_CENTER,
  BOARD_SIZE,
  LAB_CAMERA,
  LAB_PROJECTOR,
  LAB_STEREO,
  placementPose,
  type BoardPlacement,
} from "./rig";

const S = 0.01;
/** OpenCV camera frame (x right, y down, z forward) → three.js display (y up). */
const disp = (p: Vec3) => new THREE.Vector3(p[0] * S, -p[1] * S, -p[2] * S);
const D = new THREE.Matrix4().makeScale(1, -1, -1);

function boardTexture() {
  const px = 4;
  const w = (BOARD_SIZE.x1 - BOARD_SIZE.x0) * px,
    h = (BOARD_SIZE.y1 - BOARD_SIZE.y0) * px;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#e8e8e8";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#2a2a2a";
  const s = BOARD.square * px;
  for (let j = 0; j <= BOARD.rows; j++)
    for (let i = 0; i <= BOARD.cols; i++)
      if ((i + j) % 2 === 0)
        g.fillRect(
          (BOARD.border + i * BOARD.square) * px,
          (BOARD.border + j * BOARD.square) * px,
          s,
          s,
        );
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function frustum(
  K: Intrinsics,
  pose: Pose,
  depth: number,
  color: string,
  dashed = false,
) {
  const toRef = invertPose(pose);
  const c = applyPose(toRef, [0, 0, 0]);
  const corner = (u: number, v: number) =>
    applyPose(toRef, [
      ((u - K.cx) / K.fx) * depth,
      ((v - K.cy) / K.fy) * depth,
      depth,
    ]);
  const r = [
    corner(0, 0),
    corner(K.width, 0),
    corner(K.width, K.height),
    corner(0, K.height),
  ];
  const pts: Vec3[] = [];
  for (let i = 0; i < 4; i++) pts.push(c, r[i], r[i], r[(i + 1) % 4]);
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(disp));
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.06 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
  const lines = new THREE.LineSegments(geo, mat);
  if (dashed) lines.computeLineDistances();
  const group = new THREE.Group();
  group.add(lines);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.4, 0.6),
    new THREE.MeshStandardMaterial({ color: "#3a4656", roughness: 0.6 }),
  );
  body.position.copy(disp(c));
  const R = new THREE.Matrix4().set(
    pose.R[0][0],
    pose.R[0][1],
    pose.R[0][2],
    0,
    pose.R[1][0],
    pose.R[1][1],
    pose.R[1][2],
    0,
    pose.R[2][0],
    pose.R[2][1],
    pose.R[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  // Device axes in display frame: D · Rᵀ · D.
  body.quaternion.setFromRotationMatrix(
    D.clone().multiply(R.clone().transpose()).multiply(D),
  );
  body.translateZ(0.3);
  group.add(body);
  return group;
}

function outline(p: BoardPlacement, color: string) {
  const pose = placementPose(p);
  const q: Vec3[] = [
    [BOARD_SIZE.x0, BOARD_SIZE.y0, 0],
    [BOARD_SIZE.x1, BOARD_SIZE.y0, 0],
    [BOARD_SIZE.x1, BOARD_SIZE.y1, 0],
    [BOARD_SIZE.x0, BOARD_SIZE.y1, 0],
  ];
  const pts = q.map((x) => disp(applyPose(pose, x)));
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
  );
}

export function placementFromObject(o: THREE.Object3D): BoardPlacement {
  const Rd = new THREE.Matrix4().makeRotationFromQuaternion(o.quaternion);
  const R = D.clone().multiply(Rd).multiply(D);
  const e = new THREE.Euler().setFromRotationMatrix(R, "XYZ");
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;
  return {
    x: Math.round(o.position.x / S),
    y: Math.round(-o.position.y / S),
    z: Math.round(-o.position.z / S),
    rx: deg(e.x),
    ry: deg(e.y),
    rz: deg(e.z),
  };
}

function applyPlacement(o: THREE.Object3D, p: BoardPlacement) {
  const pose = placementPose(p);
  const R = new THREE.Matrix4().set(
    pose.R[0][0],
    pose.R[0][1],
    pose.R[0][2],
    0,
    pose.R[1][0],
    pose.R[1][1],
    pose.R[1][2],
    0,
    pose.R[2][0],
    pose.R[2][1],
    pose.R[2][2],
    0,
    0,
    0,
    0,
    1,
  );
  o.quaternion.setFromRotationMatrix(D.clone().multiply(R).multiply(D));
  o.position.copy(disp([p.x, p.y, p.z]));
}

export default function LabScene({
  placement,
  onPlacement,
  mode,
  ghosts,
  estimatedProjector,
}: {
  placement: BoardPlacement;
  onPlacement: (p: BoardPlacement) => void;
  mode: "translate" | "rotate";
  ghosts: BoardPlacement[];
  estimatedProjector: { K: Intrinsics; pose: Pose } | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    setPlacement: (p: BoardPlacement) => void;
    setMode: (m: "translate" | "rotate") => void;
    setGhosts: (g: BoardPlacement[]) => void;
    setEstimate: (e: { K: Intrinsics; pose: Pose } | null) => void;
    home: () => void;
  } | null>(null);
  const onChange = useRef(onPlacement);
  onChange.current = onPlacement;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      el.textContent = "此瀏覽器無法使用 WebGL：仍可用右側滑桿擺放板子。";
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x10161e);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdde8ff, 0x202830, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const floor = new THREE.GridHelper(16, 32, 0x2a3644, 0x1c2530);
    floor.position.y = -2.6;
    floor.position.z = -4;
    scene.add(floor);
    scene.add(
      frustum(
        LAB_CAMERA,
        {
          R: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          t: [0, 0, 0],
        },
        700,
        "#5ee4bd",
      ),
    );
    scene.add(frustum(LAB_PROJECTOR, LAB_STEREO, 700, "#b7a0fa"));

    const viewer = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    const orbit = new OrbitControls(viewer, renderer.domElement);
    const render = () => renderer.render(scene, viewer);
    orbit.addEventListener("change", render);

    const board = new THREE.Group();
    const w = (BOARD_SIZE.x1 - BOARD_SIZE.x0) * S,
      h = (BOARD_SIZE.y1 - BOARD_SIZE.y0) * S;
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.8 }),
    );
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: "#6d6255",
        side: THREE.BackSide,
      }),
    );
    // Geometry is centred on the corner-grid centre (board extents are symmetric about it).
    const off = disp([
      (BOARD_SIZE.x0 + BOARD_SIZE.x1) / 2 - BOARD_CENTER[0],
      (BOARD_SIZE.y0 + BOARD_SIZE.y1) / 2 - BOARD_CENTER[1],
      0,
    ]);
    front.position.copy(off);
    back.position.copy(off);
    board.add(front, back);
    scene.add(board);

    const gizmo = new TransformControls(viewer, renderer.domElement);
    gizmo.attach(board);
    gizmo.setSize(0.8);
    gizmo.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
    });
    gizmo.addEventListener("objectChange", () =>
      onChange.current(placementFromObject(board)),
    );
    gizmo.addEventListener("change", render);
    scene.add(gizmo.getHelper());

    const ghostGroup = new THREE.Group();
    scene.add(ghostGroup);
    let estimate: THREE.Group | null = null;

    const home = () => {
      viewer.position.set(4.8, 2.7, 2.2);
      orbit.target.set(0.3, -0.3, -4.0);
      orbit.update();
      render();
    };
    const resize = () => {
      const cw = el.clientWidth,
        ch = el.clientHeight;
      renderer.setSize(cw, ch);
      viewer.aspect = cw / Math.max(1, ch);
      viewer.updateProjectionMatrix();
      render();
    };
    api.current = {
      setPlacement: (p) => {
        if (gizmo.dragging) return;
        applyPlacement(board, p);
        render();
      },
      setMode: (m) => gizmo.setMode(m),
      setGhosts: (list) => {
        ghostGroup.clear();
        for (const g of list) ghostGroup.add(outline(g, "#8fa3b8"));
        render();
      },
      setEstimate: (e) => {
        if (estimate) scene.remove(estimate);
        estimate = e ? frustum(e.K, e.pose, 700, "#ffd166", true) : null;
        if (estimate) scene.add(estimate);
        render();
      },
      home,
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    home();
    resize();
    return () => {
      observer.disconnect();
      gizmo.dispose();
      orbit.dispose();
      renderer.dispose();
      el.innerHTML = "";
      api.current = null;
    };
  }, []);

  useEffect(() => api.current?.setPlacement(placement), [placement]);
  useEffect(() => api.current?.setMode(mode), [mode]);
  useEffect(() => api.current?.setGhosts(ghosts), [ghosts]);
  useEffect(
    () => api.current?.setEstimate(estimatedProjector),
    [estimatedProjector],
  );

  return (
    <div className="lab-scene">
      <div ref={host} className="lab-scene-canvas" />
      <button className="lab-scene-home" onClick={() => api.current?.home()}>
        重設視角
      </button>
    </div>
  );
}
