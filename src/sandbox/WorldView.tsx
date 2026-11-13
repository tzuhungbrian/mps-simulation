import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { createViewControls } from "./viewControls";
import {
  BOARD_SHAPES,
  createWorld,
  DEVICE_LIMITS,
  fringePatterns,
  getRig,
  LEGACY_UNIT_MM,
  pinholesFor,
  rigTarget,
  validateWorldConfig,
  WORLD_LIMITS,
  type WorldConfig,
  type runWorldScan,
} from "./scanner";
import { cameraRay, type Pinhole } from "./geometry";

type Scan = ReturnType<typeof runWorldScan>;
export type RigDevice = "camera" | "projector";
type Selection = "object" | { kind: RigDevice; id: string };
/** The 3D view keeps its original scale: one display unit is 25 mm. */
const DISPLAY = 1 / LEGACY_UNIT_MM;
const rigKey = (c: WorldConfig) =>
  JSON.stringify([
    c.x,
    c.y,
    c.z,
    c.aimX,
    c.aimZ,
    c.cameras,
    c.projectors,
    c.activeCamera,
    c.activeProjector,
    c.projectorWidth,
  ]);
export interface WorldViewApi {
  resetView: () => void;
  snapshot: () => Promise<Blob>;
}
export interface OverlayCloud {
  /** World points (x, y, z) in mm. */
  points: Float32Array;
  /** Height colour range in world Y, mm. */
  range: [number, number];
}
interface Props {
  config: WorldConfig;
  scan: Scan | null;
  probe: number;
  frame: number;
  showCloud: boolean;
  showRays: boolean;
  /** Multi-view result shown in the same space (a pair or a fusion). */
  overlay?: OverlayCloud | null;
  onMove: (x: number, y: number, z: number) => void;
  onDevice: (
    kind: RigDevice,
    id: string,
    x: number,
    y: number,
    z: number,
  ) => void;
  onActivate: (kind: RigDevice, id: string) => void;
}
const v = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]);
const display = (p: ArrayLike<number>) => v(p).multiplyScalar(DISPLAY);
function opticalCamera(p: Pinhole) {
  const c = new THREE.PerspectiveCamera(
    (2 * Math.atan(p.height / (2 * p.fy)) * 180) / Math.PI,
    p.width / p.height,
    0.05,
    25,
  );
  c.position.copy(display(p.position));
  c.up.copy(v(p.up));
  c.lookAt(display(p.position).add(v(p.forward)));
  c.updateMatrixWorld(true);
  return c;
}
const vertexShader = `attribute float surface;varying float vSurface;varying vec3 worldPoint;varying vec3 worldNormal;varying vec4 lightPoint;uniform mat4 projectorMatrix;
void main(){vSurface=surface;vec4 world=modelMatrix*vec4(position,1.0);worldPoint=world.xyz;worldNormal=normalize(mat3(modelMatrix)*normal);lightPoint=projectorMatrix*world;gl_Position=projectionMatrix*viewMatrix*world;}`;
const fragmentShader = `#include <packing>
varying float vSurface;varying vec3 worldPoint;varying vec3 worldNormal;varying vec4 lightPoint;uniform vec3 projectorPosition;uniform sampler2D projectorDepth;uniform float phaseShift;uniform float fringeFrequency;uniform float fringeOffset;uniform float fringeAmplitude;uniform vec3 albedos;
void main(){vec3 p=lightPoint.xyz/lightPoint.w;vec2 uv=p.xy*.5+.5;float depth=p.z*.5+.5;float visible=0.0;
if(lightPoint.w>0.0&&uv.x>=0.0&&uv.x<1.0&&uv.y>=0.0&&uv.y<1.0&&depth>=0.0&&depth<=1.0){float nearest=unpackRGBAToDepth(texture2D(projectorDepth,uv));visible=depth<=nearest+0.0015?1.0:0.0;}
float albedo=vSurface>2.5?albedos.z:vSurface>1.5?albedos.y:albedos.x;vec3 tint=vSurface>2.5?vec3(1.0,.86,.62):vec3(.85,.94,1.0);
float incidence=max(dot(normalize(worldNormal),normalize(projectorPosition-worldPoint)),0.0);float intensity=.12+visible*incidence*albedo*(fringeOffset+fringeAmplitude*cos(6.28318530718*fringeFrequency*uv.x-3.14159265359+phaseShift));
vec3 base=vec3(.045,.064,.087);gl_FragColor=vec4(base+tint*intensity,1.0);
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
      canvas.setAttribute(
        "aria-label",
        "3D 沙盒；左鍵點選物體、Camera 或 Projector 後拖曳彩色軸；按住滑鼠中鍵旋轉視角，滾輪縮放；WASD 移動視角，Q/E 轉向",
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
      const view = createViewControls(viewer, canvas, {
        home: (orbit) => {
          const p = latest.current;
          // Millimetre-scale AOI pieces and multi-view clouds need a close look at the aim point.
          const close =
            !!p.overlay || BOARD_SHAPES.includes(p.config.shape);
          const distanceScale =
            Math.max(0.8, 1.25 / viewer.aspect) * (close ? 0.22 : 1);
          if (close) orbit.target.copy(display(rigTarget(p.config)));
          else orbit.target.set(0, 1, 1.8);
          viewer.position
            .copy(orbit.target)
            .add(
              new THREE.Vector3(5.2, 2.8, 5.4).multiplyScalar(distanceScale),
            );
        },
        minDistance: 0.3,
      });
      const { orbit, reset } = view;
      reset();
      // scanRoot and measured are in millimetres; housings and helpers in display units.
      const scanRoot = new THREE.Group(),
        measured = new THREE.Group(),
        helpers = new THREE.Group();
      scanRoot.scale.setScalar(DISPLAY);
      measured.scale.setScalar(DISPLAY);
      scene.add(scanRoot, helpers);
      helpers.add(measured);
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
      const shared = {
        projectorMatrix: { value: new THREE.Matrix4() },
        projectorPosition: { value: new THREE.Vector3() },
        projectorDepth: { value: shadowTarget.texture },
        phaseShift: { value: 0 },
        fringeFrequency: { value: 1 },
        fringeOffset: { value: 0.4 },
        fringeAmplitude: { value: 0.36 },
      };
      const surface = () =>
        new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          side: THREE.DoubleSide,
          uniforms: {
            ...shared,
            albedos: { value: new THREE.Vector3(1, 1, 1) },
          },
        });
      const objectMaterial = surface(),
        groundMaterial = surface();
      let current = latest.current.config,
        world = createWorld(current),
        originalMaterials = world.meshes.map((m) => m.material);
      const adopt = () => {
        world.object.material = objectMaterial;
        world.ground.material = groundMaterial;
        scanRoot.add(world.scene);
      };
      adopt();
      let rig = getRig(current),
        projector = opticalCamera(rig.projector),
        shadowDirty = true,
        lastScan: Scan | null = null,
        lastProbe = -1,
        lastRays = false,
        lastOverlay: OverlayCloud | null | undefined = undefined,
        lastRigKey = "";
      const housings = new THREE.Group();
      helpers.add(housings);
      const housingOf = new Map<
        THREE.Object3D,
        { kind: RigDevice; id: string }
      >();
      const models = new Map<
        string,
        {
          group: THREE.Group;
          body: THREE.MeshBasicMaterial;
          lens: THREE.MeshBasicMaterial;
        }
      >();
      const deviceModel = (color: string) => {
        const group = new THREE.Group();
        const body = new THREE.MeshBasicMaterial({ color: "#233c52" }),
          lens = new THREE.MeshBasicMaterial({ color });
        const lensMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.105, 0.105, 0.17, 24),
          lens,
        );
        lensMesh.rotation.x = Math.PI / 2;
        lensMesh.position.z = 0.25;
        group.add(
          new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.36), body),
          lensMesh,
        );
        return { group, body, lens };
      };
      const styleModel = (
        m: {
          group: THREE.Group;
          body: THREE.MeshBasicMaterial;
          lens: THREE.MeshBasicMaterial;
        },
        active: boolean,
      ) => {
        m.body.color.set(active ? "#233c52" : "#1a2938");
        for (const material of [m.body, m.lens]) {
          material.transparent = !active;
          material.opacity = active ? 1 : 0.6;
        }
        m.group.scale.setScalar(active ? 1 : 0.7);
      };
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
        ),
        overlayCloud = new THREE.Points(
          new THREE.BufferGeometry(),
          new THREE.PointsMaterial({
            size: 0.03,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
          }),
        );
      measured.add(rigLines, rays, cloud, overlayCloud);
      cloud.renderOrder = 8;
      overlayCloud.renderOrder = 8;
      const transform = new TransformControls(viewer, canvas);
      transform.setMode("translate");
      transform.setSize(0.7);
      transform.attach(world.object);
      helpers.add(transform.getHelper());
      const snap = () =>
        transform.setTranslationSnap(selected === "object" ? 1.25 : 0.05);
      const clampPose = () => {
        const p = world.object.position;
        p.x = THREE.MathUtils.clamp(p.x, ...WORLD_LIMITS.x);
        p.y = THREE.MathUtils.clamp(p.y, ...WORLD_LIMITS.y);
        p.z = THREE.MathUtils.clamp(p.z, ...WORLD_LIMITS.z);
        latest.current.onMove(p.x, p.y, p.z);
        shadowDirty = true;
      };
      transform.addEventListener("dragging-changed", (e) => {
        orbit.enabled = !e.value;
      });
      let selected: Selection = "object";
      snap();
      const housingFor = (s: Exclude<Selection, "object">) =>
        [...housingOf].find(
          ([, d]) => d.kind === s.kind && d.id === s.id,
        )?.[0] ?? null;
      const selectionTarget = (s: Selection) =>
        s === "object" ? world.object : (housingFor(s) ?? world.object);
      const onTransform = () => {
        if (selected === "object") return clampPose();
        const target = housingFor(selected);
        if (!target) return;
        const list =
          selected.kind === "camera" ? current.cameras : current.projectors;
        const device = list.find(
          (d) => d.id === (selected as { id: string }).id,
        );
        if (!device) return;
        const mm = target.position.clone().divideScalar(DISPLAY);
        mm.x = THREE.MathUtils.clamp(mm.x, ...DEVICE_LIMITS.x);
        mm.y = THREE.MathUtils.clamp(mm.y, ...DEVICE_LIMITS.y);
        mm.z = THREE.MathUtils.clamp(mm.z, ...DEVICE_LIMITS.z);
        const key = selected.kind === "camera" ? "cameras" : "projectors";
        try {
          validateWorldConfig({
            ...current,
            [key]: list.map((d) =>
              d === device ? { ...d, x: mm.x, y: mm.y, z: mm.z } : d,
            ),
          });
        } catch {
          target.position.copy(display([device.x, device.y, device.z]));
          return;
        }
        latest.current.onDevice(selected.kind, device.id, mm.x, mm.y, mm.z);
      };
      transform.addEventListener("objectChange", onTransform);
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
          distance = 2.4 / DISPLAY;
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
      const place = (group: THREE.Object3D, p: Pinhole) => {
        group.position.copy(display(p.position));
        group.up.copy(v(p.up));
        group.lookAt(display(p.position).add(v(p.forward)));
      };
      const updateRig = () => {
        rig = getRig(current);
        projector = opticalCamera(rig.projector);
        shared.projectorMatrix.value.multiplyMatrices(
          projector.projectionMatrix,
          projector.matrixWorldInverse,
        );
        shared.projectorPosition.value.copy(display(rig.projector.position));
        clearGroup(rigLines);
        const seen = new Set<string>();
        for (const [kind, list, active, color] of [
          ["camera", current.cameras, current.activeCamera, "#69d9ff"],
          ["projector", current.projectors, current.activeProjector, "#ffce72"],
        ] as const)
          for (const device of list) {
            const key = `${kind}:${device.id}`,
              on = device.id === active;
            seen.add(key);
            let model = models.get(key);
            if (!model) {
              model = deviceModel(color);
              models.set(key, model);
              housings.add(model.group);
              housingOf.set(model.group, { kind, id: device.id });
            }
            styleModel(model, on);
            const pinholes = pinholesFor(
              current,
              kind === "camera" ? device : current.cameras[0],
              kind === "projector" ? device : current.projectors[0],
            );
            place(
              model.group,
              kind === "camera" ? pinholes.camera : pinholes.projector,
            );
            if (!on)
              rigLines.add(
                line(
                  [v([device.x, device.y, device.z]), v(rigTarget(current))],
                  color,
                  0.18,
                ),
              );
          }
        for (const [key, model] of models)
          if (!seen.has(key)) {
            if (transform.object === model.group) {
              selected = "object";
              transform.attach(world.object);
              snap();
            }
            housings.remove(model.group);
            housingOf.delete(model.group);
            model.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
            model.body.dispose();
            model.lens.dispose();
            models.delete(key);
          }
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
      const cameraLabel = document.createElement("span"),
        projectorLabel = document.createElement("span");
      cameraLabel.className = "sandbox-world-label camera";
      projectorLabel.className = "sandbox-world-label projector";
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
          const p = display(position)
            .add(new THREE.Vector3(0, 0.36, 0))
            .project(viewer);
          element.style.left = `${(p.x * 0.5 + 0.5) * parent.clientWidth}px`;
          element.style.top = `${(-p.y * 0.5 + 0.5) * parent.clientHeight}px`;
          element.hidden = p.z > 1;
        }
      };
      const setCloud = (
        target: THREE.Points,
        positions: ArrayLike<number>,
        colorOf: (y: number) => THREE.Color,
      ) => {
        target.geometry.dispose();
        const colors = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
          const c = colorOf(positions[i + 1]);
          colors.set([c.r, c.g, c.b], i);
        }
        target.geometry = new THREE.BufferGeometry();
        target.geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(Array.from(positions), 3),
        );
        target.geometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(colors, 3),
        );
        target.geometry.computeBoundingSphere();
      };
      const rebuildCloud = (scan: Scan | null) => {
        const positions: number[] = [];
        if (scan)
          for (let i = 0; i < scan.reconstruction.valid.length; i++)
            if (scan.reconstruction.valid[i])
              positions.push(
                ...scan.reconstruction.points.subarray(i * 3, i * 3 + 3),
              );
        setCloud(cloud, positions, (y) =>
          new THREE.Color().setHSL(
            0.52 - Math.min(2.5, Math.max(0, y * DISPLAY)) * 0.15,
            0.85,
            0.6,
          ),
        );
      };
      const rebuildOverlay = (overlay: OverlayCloud | null | undefined) => {
        const [lo, hi] = overlay?.range ?? [0, 1];
        setCloud(overlayCloud, overlay?.points ?? [], (y) =>
          new THREE.Color().setHSL(
            0.66 -
              0.66 *
                Math.min(1, Math.max(0, (y - lo) / Math.max(1e-6, hi - lo))),
            0.9,
            0.58,
          ),
        );
        overlayCloud.visible = !!overlay;
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
          new THREE.SphereGeometry(0.065 / DISPLAY, 16, 12),
          new THREE.MeshBasicMaterial({ color: "#ff8c73", depthTest: false }),
        );
        marker.position.copy(point);
        marker.renderOrder = 9;
        rays.add(marker);
        const u = scan.reconstruction.column[p.probe],
          origin = v(scan.projector.position),
          reach = 6 / DISPLAY;
        const top = origin
            .clone()
            .add(v(cameraRay(scan.projector, u, -0.5)).multiplyScalar(reach)),
          bottom = origin
            .clone()
            .add(
              v(
                cameraRay(scan.projector, u, scan.projector.height - 0.5),
              ).multiplyScalar(reach),
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
          const shapeChanged =
            p.config.shape !== current.shape ||
            (p.config.shape === "vgroove" &&
              p.config.grooveAngle !== current.grooveAngle);
          if (shapeChanged) {
            transform.detach();
            scanRoot.remove(world.scene);
            world.meshes.forEach((m, i) => (m.material = originalMaterials[i]));
            world.dispose();
            world = createWorld(p.config);
            originalMaterials = world.meshes.map((m) => m.material);
            adopt();
            transform.attach(selectionTarget(selected));
            shadowDirty = true;
            if (!view.userMoved) reset();
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
          const key = rigKey(current);
          if (key !== lastRigKey) {
            lastRigKey = key;
            updateRig();
          }
          cameraLabel.textContent =
            current.cameras.length > 1
              ? `Camera ${current.activeCamera}`
              : "Camera";
          projectorLabel.textContent =
            current.projectors.length > 1
              ? `Projector ${current.activeProjector}`
              : "Projector";
          const patterns = fringePatterns(current),
            pattern = patterns[Math.min(p.frame, patterns.length - 1)];
          shared.phaseShift.value = pattern.shift;
          shared.fringeFrequency.value = pattern.frequency;
          shared.fringeOffset.value = current.fringeOffset;
          shared.fringeAmplitude.value = current.fringeAmplitude;
          // GPU preview has no specular term, so metals use their specular weight to stay visible.
          const shown = (albedo: number, specular: number) =>
            Math.max(albedo, 0.6 * specular);
          const c = p.config;
          objectMaterial.uniforms.albedos.value.set(
            shown(c.objectAlbedo, c.objectSpecular),
            shown(c.chipAlbedo, c.chipSpecular),
            shown(c.pinAlbedo, c.pinSpecular),
          );
          groundMaterial.uniforms.albedos.value.setScalar(
            shown(c.groundAlbedo, c.groundSpecular),
          );
          if (lastScan !== p.scan) {
            rebuildCloud(p.scan);
            lastScan = p.scan;
            lastProbe = -1;
          }
          cloud.visible = p.showCloud && !!p.scan;
          if (lastOverlay !== p.overlay) {
            rebuildOverlay(p.overlay);
            if (lastOverlay !== undefined) reset();
            lastOverlay = p.overlay;
          }
          if (lastProbe !== p.probe || lastRays !== p.showRays || !p.scan) {
            rebuildRays(p);
            lastProbe = p.probe;
            lastRays = p.showRays;
          }
          render();
        },
      };
      runtime.current.update(latest.current);
      const picker = new THREE.Raycaster(),
        pointer = new THREE.Vector2();
      const pick = (e: PointerEvent) => {
        // The gizmo's own listener runs first; keep its drag target.
        if (e.button !== 0 || transform.dragging || transform.axis) return;
        const r = canvas.getBoundingClientRect();
        pointer.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        );
        picker.setFromCamera(pointer, viewer);
        const candidates = [world.object, ...housingOf.keys()];
        let hit: THREE.Object3D | null =
          picker.intersectObjects(candidates, true)[0]?.object ?? null;
        while (hit && hit !== world.object && !housingOf.has(hit))
          hit = hit.parent;
        if (!hit) return;
        const device = housingOf.get(hit);
        selected = device ?? "object";
        transform.attach(selectionTarget(selected));
        snap();
        if (device) {
          const active =
            device.kind === "camera"
              ? current.activeCamera
              : current.activeProjector;
          if (device.id !== active)
            latest.current.onActivate(device.kind, device.id);
        }
        render();
      };
      canvas.addEventListener("pointerdown", pick);
      orbit.addEventListener("change", render);
      transform.addEventListener("change", render);
      const observer = new ResizeObserver(() => {
        if (!parent.clientWidth || !parent.clientHeight) return;
        renderer.setSize(parent.clientWidth, parent.clientHeight);
        viewer.aspect = parent.clientWidth / parent.clientHeight;
        viewer.updateProjectionMatrix();
        if (!view.userMoved) reset();
        render();
      });
      observer.observe(parent);
      render();
      return () => {
        runtime.current = null;
        observer.disconnect();
        canvas.removeEventListener("pointerdown", pick);
        view.dispose();
        transform.detach();
        transform.dispose();
        scanRoot.remove(world.scene);
        world.meshes.forEach((m, i) => (m.material = originalMaterials[i]));
        world.dispose();
        objectMaterial.dispose();
        groundMaterial.dispose();
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
