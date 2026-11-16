import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { invertPose, applyPose, type Intrinsics, type Pose } from "./camera";
import type { Vec3 } from "./linalg";

export type SceneObject =
  | {
      kind: "frustum";
      /** Reference → device. */
      pose: Pose;
      K: Intrinsics;
      color: string;
      depth: number;
      dashed?: boolean;
    }
  | {
      kind: "line";
      points: Vec3[];
      color: string;
      closed?: boolean;
      dashed?: boolean;
    }
  | {
      kind: "points";
      points: Vec3[];
      color: string | Float32Array;
      size?: number;
    };

/** camera: OpenCV camera frame (y down, z forward). world: Z-up stage frame. */
export type SceneFrame = "camera" | "world";

const SCALE = 0.01;
const toDisplay = (frame: SceneFrame, [x, y, z]: Vec3) =>
  frame === "camera"
    ? new THREE.Vector3(x, -y, -z).multiplyScalar(SCALE)
    : new THREE.Vector3(x, z, -y).multiplyScalar(SCALE);

function lineObject(
  frame: SceneFrame,
  pts: Vec3[],
  color: string,
  closed = false,
  dashed = false,
) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    (closed ? [...pts, pts[0]] : pts).map((p) => toDisplay(frame, p)),
  );
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.06, gapSize: 0.04 })
    : new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

function build(frame: SceneFrame, objects: SceneObject[]) {
  const group = new THREE.Group();
  for (const o of objects) {
    if (o.kind === "line")
      group.add(lineObject(frame, o.points, o.color, o.closed, o.dashed));
    else if (o.kind === "points") {
      const positions = new Float32Array(o.points.length * 3);
      o.points.forEach((p, i) => toDisplay(frame, p).toArray(positions, i * 3));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      const perPoint = typeof o.color !== "string";
      if (typeof o.color !== "string")
        geometry.setAttribute("color", new THREE.BufferAttribute(o.color, 3));
      group.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            size: o.size ?? 3,
            sizeAttenuation: false,
            vertexColors: perPoint,
            color: perPoint ? 0xffffff : (o.color as string),
          }),
        ),
      );
    } else {
      const toRef = invertPose(o.pose);
      const c = applyPose(toRef, [0, 0, 0]);
      const corner = (u: number, v: number): Vec3 =>
        applyPose(toRef, [
          ((u - o.K.cx) / o.K.fx) * o.depth,
          ((v - o.K.cy) / o.K.fy) * o.depth,
          o.depth,
        ]);
      const w = o.K.width,
        h = o.K.height;
      const rect = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
      group.add(lineObject(frame, rect, o.color, true, o.dashed));
      for (const r of rect)
        group.add(lineObject(frame, [c, r], o.color, false, o.dashed));
      // Image-up marker: a short tick on the top edge.
      group.add(
        lineObject(
          frame,
          [corner(w / 2, 0), corner(w / 2, -h * 0.12)],
          o.color,
          false,
          o.dashed,
        ),
      );
    }
  }
  return group;
}

export default function CalibScene({
  frame,
  objects,
  label,
}: {
  frame: SceneFrame;
  objects: SceneObject[];
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    set: (objects: SceneObject[], frame: SceneFrame) => void;
    home: () => void;
  } | null>(null);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      el.textContent =
        "此瀏覽器無法使用 WebGL，3D 圖無法顯示；數值結果不受影響。";
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x0e141c);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const viewer = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    const orbit = new OrbitControls(viewer, renderer.domElement);
    let content: THREE.Group | null = null;
    let currentFrame: SceneFrame = frame;
    const render = () => renderer.render(scene, viewer);
    orbit.addEventListener("change", render);
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      viewer.aspect = w / Math.max(1, h);
      viewer.updateProjectionMatrix();
      render();
    };
    const home = () => {
      if (!content) return;
      const sphere = new THREE.Box3()
        .setFromObject(content)
        .getBoundingSphere(new THREE.Sphere());
      const dir =
        currentFrame === "camera"
          ? new THREE.Vector3(0.75, 0.55, 0.9)
          : new THREE.Vector3(0.2, 0.9, 1.0);
      orbit.target.copy(sphere.center);
      viewer.position
        .copy(sphere.center)
        .add(dir.normalize().multiplyScalar(sphere.radius * 2.3));
      orbit.update();
      render();
    };
    api.current = {
      set: (objects, f) => {
        const first = !content || f !== currentFrame;
        currentFrame = f;
        if (content) {
          scene.remove(content);
          content.traverse((o) => {
            const m = o as THREE.Mesh;
            m.geometry?.dispose();
            (m.material as THREE.Material | undefined)?.dispose();
          });
        }
        content = build(f, objects);
        scene.add(content);
        if (first) home();
        else render();
      },
      home,
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => {
      observer.disconnect();
      orbit.dispose();
      renderer.dispose();
      el.innerHTML = "";
      api.current = null;
    };
    // The renderer lives for the component's lifetime; content updates go through api.
  }, []);

  useEffect(() => {
    api.current?.set(objects, frame);
  }, [objects, frame]);

  return (
    <figure className="calib-scene">
      <div
        ref={host}
        className="calib-scene-canvas"
        aria-label={label}
        role="img"
      />
      <figcaption>
        <span>{label}</span>
        <span className="calib-scene-help">左鍵旋轉 · 右鍵平移 · 滾輪縮放</span>
        <button onClick={() => api.current?.home()}>重設視角</button>
      </figcaption>
    </figure>
  );
}
