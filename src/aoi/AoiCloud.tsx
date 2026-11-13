import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createViewControls } from "../sandbox/viewControls";
import { devicePosition, type AoiConfig } from "./rig";
import { buildAoiScene } from "./scene";

/** Device directions are drawn at this radius: true distances (≈100 mm) would dwarf the ROI. */
const RIG_RADIUS = 9;

export default function AoiCloud({
  config,
  points,
  colorRange,
  highlight,
}: {
  config: AoiConfig;
  /** World points (x, y, z) in mm, or null for the rig only. */
  points: Float32Array | null;
  colorRange: [number, number];
  /** Device ids to emphasise (the selected pair). */
  highlight: string[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
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
      setError("此裝置無法建立 WebGL，無法顯示 3D 點雲；其他分頁仍可使用。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(parent.clientWidth, parent.clientHeight);
    const canvas = renderer.domElement;
    canvas.dataset.testid = "aoi-canvas";
    canvas.setAttribute(
      "aria-label",
      "AOI 配置與重建點雲（mm）；中鍵旋轉、右鍵平移、滾輪縮放，R 重設",
    );
    parent.append(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c1726");
    const viewer = new THREE.PerspectiveCamera(
      45,
      parent.clientWidth / Math.max(1, parent.clientHeight),
      0.05,
      500,
    );
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => {
      disposables.push(x);
      return x;
    };
    scene.add(new THREE.AmbientLight("#ffffff", 0.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(4, 10, 6);
    scene.add(sun);

    const world = buildAoiScene(config);
    const surface = keep(
      new THREE.MeshLambertMaterial({
        color: "#6f8aa3",
        transparent: true,
        opacity: points ? 0.25 : 0.9,
      }),
    );
    for (const mesh of world.meshes) {
      mesh.material = surface;
      scene.add(mesh);
    }
    const roi = keep(
      new THREE.EdgesGeometry(
        new THREE.PlaneGeometry(config.roiWidth, config.roiHeight).rotateX(
          -Math.PI / 2,
        ),
      ),
    );
    const roiMaterial = keep(new THREE.LineBasicMaterial({ color: "#8de2c6" }));
    const roiLines = new THREE.LineSegments(roi, roiMaterial);
    roiLines.position.y = 0.01;
    scene.add(roiLines);

    const deviceGeometry = keep(new THREE.ConeGeometry(0.35, 0.9, 12));
    for (const [list, color] of [
      [config.cameras, "#7cc4ff"],
      [config.projectors, "#ffb86b"],
    ] as const)
      for (const device of list) {
        const p = new THREE.Vector3(...devicePosition(device)).setLength(
          RIG_RADIUS,
        );
        const on = highlight.includes(device.id);
        const material = keep(
          new THREE.MeshBasicMaterial({
            color: on ? "#ffffff" : color,
            transparent: !on,
            opacity: on ? 1 : 0.7,
          }),
        );
        const cone = new THREE.Mesh(deviceGeometry, material);
        cone.position.copy(p);
        cone.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, -1, 0),
          p.clone().negate().normalize(),
        );
        scene.add(cone);
        const lineGeometry = keep(
          new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3()]),
        );
        const lineMaterial = keep(
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: on ? 0.9 : 0.25,
          }),
        );
        scene.add(new THREE.Line(lineGeometry, lineMaterial));
      }

    if (points && points.length) {
      const colors = new Float32Array(points.length);
      const c = new THREE.Color(),
        [lo, hi] = colorRange;
      for (let i = 0; i < points.length; i += 3) {
        const t = Math.min(
          1,
          Math.max(0, (points[i + 1] - lo) / Math.max(1e-6, hi - lo)),
        );
        c.setHSL(0.66 - 0.66 * t, 0.85, 0.55);
        colors.set([c.r, c.g, c.b], i);
      }
      const geometry = keep(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const material = keep(
        new THREE.PointsMaterial({ size: 0.05, vertexColors: true }),
      );
      scene.add(new THREE.Points(geometry, material));
    }

    const view = createViewControls(viewer, canvas, {
      home: (orbit) => {
        orbit.target.set(0, 0.5, 0);
        viewer.position.set(9, 12, 15);
      },
      minDistance: 2,
      maxDistance: 60,
    });
    view.reset();
    const render = () => renderer.render(scene, viewer);
    view.orbit.addEventListener("change", render);
    let resizeFrame = 0;
    // Resizing inside the observer callback re-triggers it; defer to the next frame.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!parent.clientWidth || !parent.clientHeight) return;
        renderer.setSize(parent.clientWidth, parent.clientHeight);
        viewer.aspect = parent.clientWidth / parent.clientHeight;
        viewer.updateProjectionMatrix();
        render();
      });
    });
    observer.observe(parent);
    render();
    return () => {
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      view.dispose();
      disposables.forEach((d) => d.dispose());
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [config, points, colorRange, highlight]);
  return (
    <div className="aoi-cloud" ref={host}>
      {error && (
        <div className="sandbox-gpu-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
