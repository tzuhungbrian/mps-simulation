import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);

/**
 * Sandbox camera: middle-drag rotates, right-drag pans, wheel zooms,
 * WASD pans, Q/E turns, R returns to `home`. Left button stays free for picking.
 */
export function createViewControls(
  viewer: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  options: {
    home: (orbit: OrbitControls) => void;
    minDistance?: number;
    maxDistance?: number;
  },
) {
  const orbit = new OrbitControls(viewer, canvas);
  orbit.enableDamping = false;
  orbit.minDistance = options.minDistance ?? 2;
  orbit.maxDistance = options.maxDistance ?? 18;
  orbit.minPolarAngle = 0.15;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };
  canvas.tabIndex = 0;
  let userMoved = false;
  orbit.addEventListener("start", () => {
    userMoved = true;
  });
  const reset = () => {
    userMoved = false;
    options.home(orbit);
    orbit.update();
  };

  const held = new Set<string>();
  const yAxis = new THREE.Vector3(0, 1, 0),
    ahead = new THREE.Vector3(),
    side = new THREE.Vector3(),
    step = new THREE.Vector3(),
    offset = new THREE.Vector3();
  let moveFrame = 0,
    lastTick = 0;
  const tick = () => {
    const now = performance.now(),
      dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    ahead.subVectors(orbit.target, viewer.position).setY(0).normalize();
    side.crossVectors(ahead, yAxis);
    step.set(0, 0, 0);
    if (held.has("KeyW")) step.add(ahead);
    if (held.has("KeyS")) step.sub(ahead);
    if (held.has("KeyD")) step.add(side);
    if (held.has("KeyA")) step.sub(side);
    if (step.lengthSq() > 0) {
      // Pan speed follows zoom distance, like a city-builder camera.
      step
        .normalize()
        .multiplyScalar(0.8 * viewer.position.distanceTo(orbit.target) * dt);
      step.set(
        THREE.MathUtils.clamp(orbit.target.x + step.x, -6, 6) - orbit.target.x,
        0,
        THREE.MathUtils.clamp(orbit.target.z + step.z, -6, 6) - orbit.target.z,
      );
      orbit.target.add(step);
      viewer.position.add(step);
    }
    const turn = (held.has("KeyQ") ? 1 : 0) - (held.has("KeyE") ? 1 : 0);
    if (turn) {
      offset
        .subVectors(viewer.position, orbit.target)
        .applyAxisAngle(yAxis, turn * 1.4 * dt);
      viewer.position.copy(orbit.target).add(offset);
    }
    orbit.update();
    moveFrame = held.size ? requestAnimationFrame(tick) : 0;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (MOVE_KEYS.has(e.code)) {
      e.preventDefault();
      userMoved = true;
      held.add(e.code);
      if (!moveFrame) {
        lastTick = performance.now();
        moveFrame = requestAnimationFrame(tick);
      }
    } else if (e.code === "KeyR") {
      e.preventDefault();
      reset();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
  const releaseKeys = () => held.clear();
  // Stop the browser's middle-click autoscroll from hijacking rotation.
  const blockAutoScroll = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  const focus = () => canvas.focus({ preventScroll: true });
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("blur", releaseKeys);
  canvas.addEventListener("mousedown", blockAutoScroll);
  canvas.addEventListener("pointerdown", focus);

  return {
    orbit,
    reset,
    get userMoved() {
      return userMoved;
    },
    dispose() {
      cancelAnimationFrame(moveFrame);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", releaseKeys);
      canvas.removeEventListener("mousedown", blockAutoScroll);
      canvas.removeEventListener("pointerdown", focus);
      orbit.dispose();
    },
  };
}
