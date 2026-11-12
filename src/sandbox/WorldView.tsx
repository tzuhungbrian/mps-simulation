import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  createWorld,
  getRig,
  type WorldConfig,
  type runWorldScan,
} from "./scanner";
import { cameraRay, type Pinhole } from "./geometry";

type Scan = ReturnType<typeof runWorldScan>;
export interface WorldViewApi {
  resetView: () => void;
  snapshot: () => Promise<Blob>;
}
interface Props {
  config: WorldConfig;
  scan: Scan | null;
  probe: number;
  frame: number;
  showCloud: boolean;
  showRays: boolean;
  onMove: (x: number, y: number, z: number) => void;
}
const v = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]);
function opticalCamera(p: Pinhole) {
  const c = new THREE.PerspectiveCamera(
    (2 * Math.atan(p.height / (2 * p.fy)) * 180) / Math.PI,
    p.width / p.height,
    0.05,
    25,
  );
  c.position.copy(v(p.position));
  c.up.copy(v(p.up));
  c.lookAt(v(p.position).add(v(p.forward)));
  c.updateMatrixWorld(true);
  return c;
}
const vertexShader = `varying vec3 worldPoint;varying vec3 worldNormal;varying vec4 lightPoint;uniform mat4 projectorMatrix;
void main(){vec4 world=modelMatrix*vec4(position,1.0);worldPoint=world.xyz;worldNormal=normalize(mat3(modelMatrix)*normal);lightPoint=projectorMatrix*world;gl_Position=projectionMatrix*viewMatrix*world;}`;
const fragmentShader = `#include <packing>
varying vec3 worldPoint;varying vec3 worldNormal;varying vec4 lightPoint;uniform vec3 projectorPosition;uniform sampler2D projectorDepth;uniform float phaseShift;
void main(){vec3 p=lightPoint.xyz/lightPoint.w;vec2 uv=p.xy*.5+.5;float depth=p.z*.5+.5;float visible=0.0;
if(lightPoint.w>0.0&&uv.x>=0.0&&uv.x<1.0&&uv.y>=0.0&&uv.y<1.0&&depth>=0.0&&depth<=1.0){float nearest=unpackRGBAToDepth(texture2D(projectorDepth,uv));visible=depth<=nearest+0.0015?1.0:0.0;}
float incidence=max(dot(normalize(worldNormal),normalize(projectorPosition-worldPoint)),0.0);float intensity=.12+visible*incidence*(.4+.36*cos(6.28318530718*uv.x-3.14159265359+phaseShift));
vec3 base=vec3(.045,.064,.087);gl_FragColor=vec4(base+vec3(.85,.94,1.0)*intensity,1.0);
#include <colorspace_fragment>
}`;

const WorldView = forwardRef<WorldViewApi, Props>(
  function WorldView(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      latest = useRef(props),
      runtime = useRef<{
        update: (p: Props) => void;
        reset: () => void;
        shot: () => Promise<Blob>;
      } | null>(null);
    const [error, setError] = useState("");
    latest.current = props;
    useImperativeHandle(
      ref,
      () => ({
        resetView: () => runtime.current?.reset(),
        snapshot: () =>
          runtime.current?.shot() ??
          Promise.reject(new Error("3D 視窗尚未就緒")),
      }),
      [],
    );
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
        setError(
          "此裝置無法建立 WebGL2。仍可使用三步數學實驗，但無法顯示 3D 沙盒。",
        );
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setSize(parent.clientWidth, parent.clientHeight);
      const canvas = renderer.domElement;
      canvas.dataset.testid = "sandbox-canvas";
      canvas.tabIndex = 0;
      canvas.setAttribute(
        "aria-label",
        "3D 沙盒；滑鼠旋轉，滾輪縮放；WASD 移動物體",
      );
      parent.append(canvas);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#0c1726");
      const viewer = new THREE.PerspectiveCamera(
        46,
        parent.clientWidth / parent.clientHeight,
        0.05,
        100,
      );
      const orbit = new OrbitControls(viewer, canvas);
      orbit.enableDamping = false;
      orbit.minDistance = 2;
      orbit.maxDistance = 18;
      orbit.maxPolarAngle = Math.PI * 0.49;
      let userMoved = false;
      orbit.addEventListener("start", () => {
        userMoved = true;
      });
      const reset = () => {
        userMoved = false;
        orbit.target.set(0, 1, 1.8);
        const distanceScale = Math.max(1, 1.5 / viewer.aspect);
        viewer.position
          .copy(orbit.target)
          .add(new THREE.Vector3(5.2, 2.8, 5.4).multiplyScalar(distanceScale));
        orbit.update();
      };
      reset();
      const scanRoot = new THREE.Group(),
        helpers = new THREE.Group();
      scene.add(scanRoot, helpers);
      const grid = new THREE.GridHelper(12, 24, "#52708a", "#25394e");
      grid.position.y = 0.008;
      helpers.add(grid);
      const axes = new THREE.AxesHelper(1.2);
      axes.position.set(-3, 0.03, -2.8);
      helpers.add(axes);
      const shadowTarget = new THREE.WebGLRenderTarget(768, 768, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      const depthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        side: THREE.DoubleSide,
      });
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        uniforms: {
          projectorMatrix: { value: new THREE.Matrix4() },
          projectorPosition: { value: new THREE.Vector3() },
          projectorDepth: { value: shadowTarget.texture },
          phaseShift: { value: 0 },
        },
      });
      let current = latest.current.config,
        world = createWorld(current),
        originalMaterials = world.meshes.map((m) => m.material);
      const adopt = () => {
        world.meshes.forEach((m) => (m.material = material));
        scanRoot.add(world.scene);
      };
      adopt();
      let rig = getRig(current),
        projector = opticalCamera(rig.projector),
        shadowDirty = true,
        lastScan: Scan | null = null,
        lastProbe = -1,
        lastRays = false;
      const cameraHousing = new THREE.Group(),
        projectorHousing = new THREE.Group();
      helpers.add(cameraHousing, projectorHousing);
      const device = (group: THREE.Group, color: string) => {
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.3, 0.36),
          new THREE.MeshBasicMaterial({ color: "#233c52" }),
        );
        const lens = new THREE.Mesh(
          new THREE.CylinderGeometry(0.105, 0.105, 0.17, 24),
          new THREE.MeshBasicMaterial({ color }),
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.z = 0.25;
        group.add(body, lens);
      };
      device(cameraHousing, "#69d9ff");
      device(projectorHousing, "#ffce72");
      const rigLines = new THREE.Group(),
        rays = new THREE.Group(),
        cloud = new THREE.Points(
          new THREE.BufferGeometry(),
          new THREE.PointsMaterial({
            size: 0.033,
            vertexColors: true,
            transparent: true,
            opacity: 0.83,
            depthTest: false,
          }),
        );
      helpers.add(rigLines, rays, cloud);
      cloud.renderOrder = 8;
      const transform = new TransformControls(viewer, canvas);
      transform.setMode("translate");
      transform.setSize(0.7);
      transform.setTranslationSnap(0.05);
      transform.attach(world.object);
      helpers.add(transform.getHelper());
      const clampPose = () => {
        const p = world.object.position;
        p.x = THREE.MathUtils.clamp(p.x, -2, 2);
        p.y = THREE.MathUtils.clamp(p.y, 0.65, 2.5);
        p.z = THREE.MathUtils.clamp(p.z, -2, 2);
        latest.current.onMove(p.x, p.y, p.z);
        shadowDirty = true;
      };
      transform.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
      });
      transform.addEventListener("objectChange", clampPose);
      const clearGroup = (group: THREE.Group) => {
        while (group.children.length) {
          const child = group.children[0];
          group.remove(child);
          child.traverse((o) => {
            const item = o as THREE.Mesh;
            if (item.geometry) item.geometry.dispose();
            const mats = item.material;
            if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
            else mats?.dispose();
          });
        }
      };
      const line = (points: THREE.Vector3[], color: string, opacity = 1) =>
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
        );
      const frustum = (p: Pinhole, color: string) => {
        const origin = v(p.position),
          distance = 2.4;
        const corners = [
          [-0.5, -0.5],
          [p.width - 0.5, -0.5],
          [p.width - 0.5, p.height - 0.5],
          [-0.5, p.height - 0.5],
        ].map(([x, y]) =>
          origin.clone().add(v(cameraRay(p, x, y)).multiplyScalar(distance)),
        );
        for (const c of corners) rigLines.add(line([origin, c], color, 0.4));
        rigLines.add(line([...corners, corners[0]], color, 0.6));
      };
      const updateRig = () => {
        rig = getRig(current);
        projector = opticalCamera(rig.projector);
        material.uniforms.projectorMatrix.value.multiplyMatrices(
          projector.projectionMatrix,
          projector.matrixWorldInverse,
        );
        material.uniforms.projectorPosition.value.copy(
          v(rig.projector.position),
        );
        cameraHousing.position.copy(v(rig.camera.position));
        cameraHousing.up.copy(v(rig.camera.up));
        cameraHousing.lookAt(v(rig.camera.position).add(v(rig.camera.forward)));
        projectorHousing.position.copy(v(rig.projector.position));
        projectorHousing.up.copy(v(rig.projector.up));
        projectorHousing.lookAt(
          v(rig.projector.position).add(v(rig.projector.forward)),
        );
        clearGroup(rigLines);
        frustum(rig.camera, "#63cefa");
        frustum(rig.projector, "#ffd17b");
        rigLines.add(
          line(
            [v(rig.camera.position), v(rig.projector.position)],
            "#bac9d8",
            0.5,
          ),
        );
        shadowDirty = true;
      };
      updateRig();
      const cameraLabel = document.createElement("span"),
        projectorLabel = document.createElement("span");
      cameraLabel.className = "sandbox-world-label camera";
      projectorLabel.className = "sandbox-world-label projector";
      cameraLabel.textContent = "Camera";
      projectorLabel.textContent = "Projector";
      parent.append(cameraLabel, projectorLabel);
      const render = () => {
        if (shadowDirty) {
          const background = scene.background;
          scene.background = null;
          helpers.visible = false;
          scene.overrideMaterial = depthMaterial;
          renderer.setRenderTarget(shadowTarget);
          renderer.setClearColor(0xffffff, 1);
          renderer.clear();
          renderer.render(scene, projector);
          renderer.setRenderTarget(null);
          scene.overrideMaterial = null;
          scene.background = background;
          helpers.visible = true;
          shadowDirty = false;
        }
        renderer.render(scene, viewer);
        for (const [element, position] of [
          [cameraLabel, rig.camera.position],
          [projectorLabel, rig.projector.position],
        ] as const) {
          const p = v(position)
            .add(new THREE.Vector3(0, 0.36, 0))
            .project(viewer);
          element.style.left = `${(p.x * 0.5 + 0.5) * parent.clientWidth}px`;
          element.style.top = `${(-p.y * 0.5 + 0.5) * parent.clientHeight}px`;
          element.hidden = p.z > 1;
        }
      };
      const rebuildCloud = (scan: Scan | null) => {
        cloud.geometry.dispose();
        const positions: number[] = [],
          colors: number[] = [];
        if (scan) {
          for (let i = 0; i < scan.reconstruction.valid.length; i++) {
            if (!scan.reconstruction.valid[i]) continue;
            const point = scan.reconstruction.points.subarray(i * 3, i * 3 + 3);
            positions.push(...point);
            const color = new THREE.Color().setHSL(
              0.52 - Math.min(2.5, Math.max(0, point[1])) * 0.15,
              0.85,
              0.6,
            );
            colors.push(color.r, color.g, color.b);
          }
        }
        cloud.geometry = new THREE.BufferGeometry();
        cloud.geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        cloud.geometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(colors, 3),
        );
        cloud.geometry.computeBoundingSphere();
      };
      const rebuildRays = (p: Props) => {
        clearGroup(rays);
        if (!p.showRays || !p.scan || !p.scan.reconstruction.valid[p.probe])
          return;
        const scan = p.scan,
          point = v(
            scan.reconstruction.points.subarray(p.probe * 3, p.probe * 3 + 3),
          );
        rays.add(line([v(scan.camera.position), point], "#6bd9ff"));
        rays.add(line([v(scan.projector.position), point], "#ffd278"));
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.065, 16, 12),
          new THREE.MeshBasicMaterial({ color: "#ff8c73", depthTest: false }),
        );
        marker.position.copy(point);
        marker.renderOrder = 9;
        rays.add(marker);
        const phi = scan.reconstruction.phase.wrapped[p.probe],
          u = (scan.projector.width * (phi + Math.PI)) / (2 * Math.PI) - 0.5,
          origin = v(scan.projector.position);
        const top = origin
            .clone()
            .add(v(cameraRay(scan.projector, u, -0.5)).multiplyScalar(6)),
          bottom = origin
            .clone()
            .add(
              v(
                cameraRay(scan.projector, u, scan.projector.height - 0.5),
              ).multiplyScalar(6),
            );
        const geometry = new THREE.BufferGeometry().setFromPoints([
          origin,
          top,
          bottom,
        ]);
        geometry.setIndex([0, 1, 2]);
        geometry.computeVertexNormals();
        rays.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: "#ffc46d",
              transparent: true,
              opacity: 0.08,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
        );
      };
      runtime.current = {
        reset: () => {
          reset();
          render();
        },
        shot: () =>
          new Promise((resolve, reject) => {
            render();
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error("PNG 編碼失敗"))),
              "image/png",
            );
          }),
        update: (p) => {
          const shapeChanged = p.config.shape !== current.shape;
          const rigChanged =
            p.config.baseline !== current.baseline ||
            p.config.cameraFov !== current.cameraFov;
          if (shapeChanged) {
            transform.detach();
            scanRoot.remove(world.scene);
            world.meshes.forEach((m, i) => (m.material = originalMaterials[i]));
            world.dispose();
            world = createWorld(p.config);
            originalMaterials = world.meshes.map((m) => m.material);
            adopt();
            transform.attach(world.object);
            shadowDirty = true;
          }
          if (
            current.x !== p.config.x ||
            current.y !== p.config.y ||
            current.z !== p.config.z
          )
            shadowDirty = true;
          current = p.config;
          world.object.position.set(current.x, current.y, current.z);
          world.scene.updateMatrixWorld(true);
          if (rigChanged) updateRig();
          material.uniforms.phaseShift.value = (p.frame * 2 * Math.PI) / 3;
          if (lastScan !== p.scan) {
            rebuildCloud(p.scan);
            lastScan = p.scan;
            lastProbe = -1;
          }
          cloud.visible = p.showCloud && !!p.scan;
          if (lastProbe !== p.probe || lastRays !== p.showRays || !p.scan) {
            rebuildRays(p);
            lastProbe = p.probe;
            lastRays = p.showRays;
          }
          render();
        },
      };
      runtime.current.update(latest.current);
      const onKey = (e: KeyboardEvent) => {
        const move: Record<string, [number, number, number]> = {
          w: [0, 0, -0.1],
          s: [0, 0, 0.1],
          a: [-0.1, 0, 0],
          d: [0.1, 0, 0],
          q: [0, -0.1, 0],
          e: [0, 0.1, 0],
        };
        const delta = move[e.key.toLowerCase()];
        if (delta) {
          e.preventDefault();
          world.object.position.add(new THREE.Vector3(...delta));
          clampPose();
          render();
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          reset();
          render();
        }
      };
      canvas.addEventListener("keydown", onKey);
      const focus = () => canvas.focus({ preventScroll: true });
      canvas.addEventListener("pointerdown", focus);
      orbit.addEventListener("change", render);
      transform.addEventListener("change", render);
      const observer = new ResizeObserver(() => {
        if (!parent.clientWidth || !parent.clientHeight) return;
        renderer.setSize(parent.clientWidth, parent.clientHeight);
        viewer.aspect = parent.clientWidth / parent.clientHeight;
        viewer.updateProjectionMatrix();
        if (!userMoved) reset();
        render();
      });
      observer.observe(parent);
      render();
      return () => {
        runtime.current = null;
        observer.disconnect();
        canvas.removeEventListener("keydown", onKey);
        canvas.removeEventListener("pointerdown", focus);
        orbit.dispose();
        transform.detach();
        transform.dispose();
        scanRoot.remove(world.scene);
        world.meshes.forEach((m, i) => (m.material = originalMaterials[i]));
        world.dispose();
        material.dispose();
        depthMaterial.dispose();
        shadowTarget.dispose();
        clearGroup(helpers);
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        cameraLabel.remove();
        projectorLabel.remove();
      };
    }, []);
    useEffect(() => runtime.current?.update(props), [props]);
    return (
      <div className="sandbox-world-host" ref={host}>
        {error && (
          <div className="sandbox-gpu-error" role="alert">
            {error}
          </div>
        )}
      </div>
    );
  },
);
export default WorldView;
