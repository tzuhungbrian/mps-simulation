import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SHIFTS, TAU } from "../core/simulation";

export interface LessonSceneProps {
  step: number;
  frequency: number;
  phaseOffset: number;
  mean: number;
  amplitude: number;
  frame: number;
  /** Selected pixel as fractions of the lesson image (0 = left/top). */
  probe: number;
  row: number;
  /** Decoded wrapped phase of the selected pixel, NaN when invalid. */
  phase: number;
  /** Lesson image height / width. */
  aspect: number;
}

// Illustration rig: camera and projector side by side, both facing a flat wall at z = 0.
const CAMERA = new THREE.Vector3(-0.4, 0.8, 3.2);
const PROJECTOR = new THREE.Vector3(0.4, 0.8, 3.2);
const VIEW = { left: -1.6, width: 2.4, centerY: 0.8 };
const LIT = { left: -1.6, right: 2.4, bottom: 0.05, top: 1.55 };

const vertexShader = `varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
const fragmentShader = `varying vec3 vWorld;uniform float freq;uniform float phi0;uniform float shift;uniform float mean;uniform float amp;uniform vec4 lit;
void main(){float t=(vWorld.x-(${VIEW.left.toFixed(2)}))/${VIEW.width.toFixed(2)};
bool inside=vWorld.x>=lit.x&&vWorld.x<=lit.y&&vWorld.y>=lit.z&&vWorld.y<=lit.w;
float i=inside?mean+amp*cos(6.28318530718*freq*t+phi0+shift):0.06;
gl_FragColor=vec4(vec3(.03,.04,.06)+vec3(.85,.94,1.0)*i,1.0);
#include <colorspace_fragment>
}`;

/** Simplified 3D illustration of the 1D lesson; it does not compute the lesson's numbers. */
export default function LessonScene(props: LessonSceneProps) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    update = useRef<((p: LessonSceneProps) => void) | null>(null);
  const [error, setError] = useState("");
  latest.current = props;
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError("此裝置無法建立 WebGL，無法顯示 3D 示意。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(parent.clientWidth, parent.clientHeight);
    const canvas = renderer.domElement;
    canvas.dataset.testid = "lesson-scene-canvas";
    canvas.setAttribute(
      "aria-label",
      "3D 示意：Projector 把條紋投到牆上、Camera 拍下；拖曳可旋轉",
    );
    parent.append(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c1520");
    const viewer = new THREE.PerspectiveCamera(
      42,
      parent.clientWidth / Math.max(1, parent.clientHeight),
      0.05,
      50,
    );
    viewer.position.set(2.5, 1.7, 4.1);
    const controls = new OrbitControls(viewer, canvas);
    controls.target.set(0.25, 0.8, 0.9);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.update();

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(item: T) => {
      disposables.push(item);
      return item;
    };
    const grid = track(new THREE.GridHelper(8, 32, "#2f465a", "#1a2836"));
    scene.add(grid);
    const wallMaterial = track(
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          freq: { value: 1 },
          phi0: { value: 0 },
          shift: { value: 0 },
          mean: { value: 0.5 },
          amp: { value: 0.4 },
          lit: {
            value: new THREE.Vector4(LIT.left, LIT.right, LIT.bottom, LIT.top),
          },
        },
      }),
    );
    const wall = new THREE.Mesh(
      track(new THREE.PlaneGeometry(4.8, 1.7)),
      wallMaterial,
    );
    wall.position.set(0.4, 0.85, 0);
    scene.add(wall);

    const device = (at: THREE.Vector3, color: string) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.34, 0.24, 0.28)),
        track(new THREE.MeshBasicMaterial({ color: "#233c52" })),
      );
      const lens = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 20)),
        track(new THREE.MeshBasicMaterial({ color })),
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.z = -0.19;
      group.add(body, lens);
      group.position.copy(at);
      scene.add(group);
    };
    device(CAMERA, "#69d9ff");
    device(PROJECTOR, "#ffce72");

    const line = (points: THREE.Vector3[], color: string, opacity = 1) =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      );
    const dynamic = new THREE.Group();
    scene.add(dynamic);
    const clear = () => {
      for (const child of [...dynamic.children]) {
        dynamic.remove(child);
        const item = child as THREE.Mesh;
        item.geometry?.dispose();
        (item.material as THREE.Material)?.dispose();
      }
    };
    const render = () => renderer.render(scene, viewer);
    update.current = (p) => {
      const u = wallMaterial.uniforms;
      u.freq.value = p.frequency;
      u.phi0.value = p.phaseOffset;
      u.shift.value = SHIFTS[p.frame] ?? 0;
      u.mean.value = p.mean;
      u.amp.value = p.amplitude;
      clear();
      const height = VIEW.width * p.aspect,
        top = VIEW.centerY + height / 2,
        bottom = VIEW.centerY - height / 2,
        right = VIEW.left + VIEW.width,
        z = 0.004;
      const corners = [
        new THREE.Vector3(VIEW.left, top, z),
        new THREE.Vector3(right, top, z),
        new THREE.Vector3(right, bottom, z),
        new THREE.Vector3(VIEW.left, bottom, z),
      ];
      dynamic.add(line([...corners, corners[0]], "#63cefa"));
      for (const c of corners) dynamic.add(line([CAMERA, c], "#63cefa", 0.3));
      for (const [x, y] of [
        [LIT.left, LIT.top],
        [LIT.right, LIT.top],
        [LIT.right, LIT.bottom],
        [LIT.left, LIT.bottom],
      ])
        dynamic.add(
          line([PROJECTOR, new THREE.Vector3(x, y, z)], "#ffd17b", 0.25),
        );
      if (p.step >= 2) {
        const point = new THREE.Vector3(
          VIEW.left + p.probe * VIEW.width,
          top - p.row * height,
          z,
        );
        dynamic.add(line([CAMERA, point], "#6bd9ff"));
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 14, 10),
          new THREE.MeshBasicMaterial({ color: "#ff8c73" }),
        );
        marker.position.copy(point);
        dynamic.add(marker);
        if (p.step >= 3 && Number.isFinite(p.phase)) {
          // Every column whose phase wraps to the decoded value is a candidate light plane.
          const base = (p.phase - p.phaseOffset) / TAU;
          for (let n = Math.ceil(-base - 1); n <= p.frequency - base + 1; n++) {
            const t = (base + n) / p.frequency;
            if (t < 0 || t > 1) continue;
            const x = VIEW.left + t * VIEW.width;
            const truth = Math.abs(t - p.probe) < 0.5 / p.frequency;
            const a = new THREE.Vector3(x, LIT.top, z),
              b = new THREE.Vector3(x, LIT.bottom, z);
            dynamic.add(line([a, b], "#ffc46d", truth ? 1 : 0.55));
            const plane = new THREE.BufferGeometry().setFromPoints([
              PROJECTOR,
              a,
              b,
            ]);
            dynamic.add(
              new THREE.Mesh(
                plane,
                new THREE.MeshBasicMaterial({
                  color: "#ffc46d",
                  transparent: true,
                  opacity: truth ? 0.22 : 0.07,
                  side: THREE.DoubleSide,
                  depthWrite: false,
                }),
              ),
            );
          }
        }
      }
      render();
    };
    update.current(latest.current);
    controls.addEventListener("change", render);
    const observer = new ResizeObserver(() => {
      if (!parent.clientWidth || !parent.clientHeight) return;
      renderer.setSize(parent.clientWidth, parent.clientHeight);
      viewer.aspect = parent.clientWidth / parent.clientHeight;
      viewer.updateProjectionMatrix();
      render();
    });
    observer.observe(parent);
    return () => {
      update.current = null;
      observer.disconnect();
      controls.dispose();
      clear();
      scene.traverse((o) => {
        const l = o as THREE.Line;
        if (l.isLine) {
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);
  useEffect(() => update.current?.(props), [props]);
  return (
    <div className="lesson-scene" ref={host}>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
