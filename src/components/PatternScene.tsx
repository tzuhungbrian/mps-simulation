import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { rasterize } from "../lib/images";

export default function PatternScene({
  frame,
  width,
  height,
}: {
  frame: Float64Array;
  width: number;
  height: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("此裝置無法建立 WebGL context；數學解算與 2D 影像仍可使用。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.domElement.setAttribute(
      "aria-label",
      "可旋轉的平面條紋 WebGL 示意，非 3D 量測",
    );
    renderer.domElement.dataset.testid = "webgl-canvas";
    parent.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0e141d");
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(3.2, 2.3, 6.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.2, 0);
    controls.enableDamping = true;
    controls.minDistance = 3;
    controls.maxDistance = 15;
    controls.enablePan = false;
    const texture = new THREE.CanvasTexture(
      rasterize(frame, width, height, "intensity"),
    );
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    const geometry = new THREE.PlaneGeometry(5, 2),
      material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.y = 0.3;
    scene.add(plane);
    const edgeGeometry = new THREE.EdgesGeometry(geometry),
      edgeMaterial = new THREE.LineBasicMaterial({ color: "#5ee4bd" }),
      edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.position.copy(plane.position);
    edges.position.z = 0.005;
    scene.add(edges);
    const grid = new THREE.GridHelper(12, 24, "#304154", "#1b2634");
    grid.position.y = -0.75;
    scene.add(grid);
    const axes = new THREE.AxesHelper(0.8);
    axes.position.set(-2.8, -0.75, 0);
    scene.add(axes);
    // A change listener must render only: calling controls.update() here
    // synchronously emits another change event and recurses under reduced motion.
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.enableDamping = !reduced;
    const render = () => renderer.render(scene, camera);
    const observer = new ResizeObserver(() => {
      const { width: w, height: h } = parent.getBoundingClientRect();
      if (w && h) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        render();
      }
    });
    observer.observe(parent);
    let handle = 0;
    const animate = () => {
      controls.update();
      render();
      handle = requestAnimationFrame(animate);
    };
    controls.update();
    if (reduced) {
      controls.addEventListener("change", render);
      render();
    } else animate();
    return () => {
      cancelAnimationFrame(handle);
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [frame, width, height]);
  return (
    <div className="scene-wrap">
      <div className="scene-host" ref={host} />
      {error && (
        <p className="scene-error" role="alert">
          {error}
        </p>
      )}
      <span className="scene-badge">Three.js / WebGL · 拖曳旋轉</span>
      <span className="scene-note">僅平面紋理示意，不參與 phase 解算</span>
    </div>
  );
}
