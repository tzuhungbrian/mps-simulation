import { MeshBasicMaterial, BoxGeometry, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  DEFAULT_WORLD,
  fringePatterns,
  getRig,
  captureWorld,
  reconstructCaptures,
  runWorldScan,
  parseWorldConfig,
  validateWorldConfig,
} from "./scanner";
import { cameraRay, makePinhole, projectPoint, type Vec3 } from "./geometry";
import { MATERIAL_PRESETS } from "./lightTransport";
import { decodeNStep, SHIFTS, TAU } from "../core/simulation";

describe("CPU calibrated scanner", () => {
  it("reports null RMSE when a one-pixel scan sees an unilluminated surface", () => {
    const result = runWorldScan(
      { ...DEFAULT_WORLD, cameraX: -1.5, projectorX: 1.5, x: 0.5, z: -1 },
      1,
      1,
    );
    expect(result.metrics.cameraHitCount).toBe(1);
    expect(result.capture.shadowMask[0]).toBe(1);
    expect(result.metrics.validCount).toBe(0);
    expect(result.metrics.evaluatedCount).toBe(0);
    expect(result.metrics.rmseDepth).toBeNull();
    expect(result.metrics.validRatio).toBe(0);
  });
  it("leaves background, silhouettes and projector-shadowed surfaces unmodulated and invalid", () => {
    // A side-and-above rig so the view includes sky background beyond the ground.
    const config = {
      ...DEFAULT_WORLD,
      cameraX: -1,
      cameraY: 1.8,
      cameraZ: 4,
      projectorX: 1,
      projectorY: 2.3,
      projectorZ: 3.5,
    };
    const { capture, reconstruction, camera, projector } = runWorldScan(config);
    const world = createWorld(config);
    const origin = new Vector3(...projector.position);
    let background = 0,
      shadow = 0,
      occludedGround = 0;
    try {
      for (let i = 0; i < capture.width * capture.height; i++) {
        if (!capture.cameraHit[i]) {
          background++;
          expect(Number.isNaN(capture.truthDepth[i])).toBe(true);
        } else if (capture.shadowMask[i]) {
          shadow++;
          const ray = cameraRay(
            camera,
            i % capture.width,
            Math.floor(i / capture.width),
          );
          const range =
            capture.truthDepth[i] /
            ray.reduce((sum, v, axis) => sum + v * camera.forward[axis], 0);
          const point = ray.map(
            (v, axis) => camera.position[axis] + v * range,
          ) as Vec3;
          const pp = projectPoint(projector, point)!;
          if (
            Math.abs(point[1]) < 1e-8 &&
            pp.u >= -0.5 &&
            pp.u < projector.width - 0.5 &&
            pp.v >= -0.5 &&
            pp.v < projector.height - 0.5
          ) {
            const direction = new Vector3(...point).sub(origin).normalize();
            const nearest = new Raycaster(origin, direction).intersectObjects(
              world.meshes,
            )[0];
            expect(nearest.object).toBe(world.object);
            expect(nearest.distance).toBeLessThan(
              origin.distanceTo(new Vector3(...point)) - 1e-5,
            );
            occludedGround++;
          }
        } else continue;
        expect(capture.frames.map((frame) => frame[i])).toEqual([
          0.12, 0.12, 0.12,
        ]);
        expect(reconstruction.phase.modulation[i]).toBeLessThan(1e-15);
        expect(reconstruction.phase.valid[i]).toBe(0);
        expect(reconstruction.valid[i]).toBe(0);
        expect(Number.isNaN(reconstruction.depth[i])).toBe(true);
        expect(
          Array.from(reconstruction.points.slice(i * 3, i * 3 + 3)).every(
            Number.isNaN,
          ),
        ).toBe(true);
      }
    } finally {
      world.dispose();
    }
    expect(background).toBeGreaterThan(0);
    expect(shadow).toBeGreaterThan(0);
    expect(occludedGround).toBeGreaterThan(0);
  });

  it("never reads truth or visibility at the inverse boundary, and intensities actually determine depth", () => {
    const { capture, reconstruction, camera, projector } = runWorldScan(
      DEFAULT_WORLD,
      32,
      24,
    );
    capture.truthDepth.fill(123456);
    capture.cameraHit.fill(0);
    capture.shadowMask.fill(1);
    const mutated = reconstructCaptures(capture, camera, projector);
    expect(mutated.depth).toEqual(reconstruction.depth);
    expect(mutated.points).toEqual(reconstruction.points);
    const payload = {
      width: capture.width,
      height: capture.height,
      frames: capture.frames,
      clipped: capture.clipped,
    };
    const noTruth = new Proxy(payload, {
      get(target, key, receiver) {
        if (
          [
            "truthDepth",
            "cameraHit",
            "shadowMask",
            "meshes",
            "referencePhase",
          ].includes(String(key))
        )
          throw new Error(`Forbidden inverse access: ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
    });
    expect(reconstructCaptures(noTruth, camera, projector).depth).toEqual(
      reconstruction.depth,
    );
    const perturbedFrames = capture.frames.map((frame, k) =>
      Float64Array.from(frame, (_, i) => {
        const phase = reconstruction.phase.wrapped[i];
        return Number.isFinite(phase)
          ? 0.5 + 0.2 * Math.cos(phase + 0.03 + SHIFTS[k])
          : 0.12;
      }),
    ) as [Float64Array, Float64Array, Float64Array];
    const perturbed = reconstructCaptures(
      { ...payload, frames: perturbedFrames },
      camera,
      projector,
    );
    const i = reconstruction.valid.findIndex(
      (v, index) => v === 1 && perturbed.valid[index] === 1,
    );
    expect(i).toBeGreaterThanOrEqual(0);
    expect(
      Math.abs(perturbed.depth[i] - reconstruction.depth[i]),
    ).toBeGreaterThan(0.001);
    const noSignal = reconstructCaptures(
      {
        ...payload,
        frames: capture.frames.map((frame) =>
          new Float64Array(frame.length).fill(0.12),
        ) as [Float64Array, Float64Array, Float64Array],
      },
      camera,
      projector,
    );
    expect(noSignal.validCount).toBe(0);
    expect(noSignal.depth.every(Number.isNaN)).toBe(true);
  });

  it("moving the object and changing shape alters real captures while ideal inversion remains accurate", () => {
    const original = runWorldScan(DEFAULT_WORLD, 48, 36);
    for (const shape of ["sphere", "box", "ramp", "vgroove"] as const) {
      const config = { ...DEFAULT_WORLD, shape, x: 0.6, y: 1.1, z: -0.4 };
      const moved = runWorldScan(config, 48, 36);
      expect(moved.capture.frames).not.toEqual(original.capture.frames);
      expect(moved.metrics.rmseDepth).not.toBeNull();
      expect(moved.metrics.rmseDepth!).toBeLessThan(1e-10);
      const world = createWorld(config);
      expect(world.object.position.toArray()).toEqual([0.6, 1.1, -0.4]);
      expect(world.object.rotation.z).toBe(shape === "ramp" ? -0.35 : 0);
      world.dispose();
    }
    const noisy = runWorldScan({ ...DEFAULT_WORLD, noiseSigma: 0.003 }, 48, 36);
    expect(noisy.metrics.rmseDepth!).toBeGreaterThan(1e-5);
    expect(noisy.metrics.evaluatedCount).toBeLessThanOrEqual(
      noisy.metrics.validCount,
    );
  });

  it("rejects clipped and nonfinite intensity samples without substituting a mesh depth", () => {
    const { capture, camera, projector } = runWorldScan(DEFAULT_WORLD, 8, 6);
    const first = reconstructCaptures(
      capture,
      camera,
      projector,
    ).valid.findIndex((v) => v === 1);
    expect(first).toBeGreaterThanOrEqual(0);
    capture.clipped[first] = 1;
    let inverse = reconstructCaptures(capture, camera, projector);
    expect(inverse.phase.valid[first]).toBe(0);
    expect(Number.isNaN(inverse.depth[first])).toBe(true);
    capture.clipped[first] = 0;
    capture.frames[0][first] = Infinity;
    inverse = reconstructCaptures(capture, camera, projector);
    expect(inverse.valid[first]).toBe(0);
    expect(Number.isNaN(inverse.depth[first])).toBe(true);
  });

  it("rejects malformed capture dimensions and calibration resolution mismatches", () => {
    const { camera, projector } = getRig(DEFAULT_WORLD, 2, 1);
    const frames: [Float64Array, Float64Array, Float64Array] = [
      new Float64Array(1),
      new Float64Array(1),
      new Float64Array(1),
    ];
    const input = { width: 2, height: 1, frames, clipped: new Uint8Array(1) };
    expect(() => reconstructCaptures(input, camera, projector)).toThrow(
      RangeError,
    );
    expect(() =>
      reconstructCaptures({ ...input, width: 1 }, camera, projector),
    ).toThrow(RangeError);
    expect(() =>
      reconstructCaptures({ ...input, width: 0 }, camera, projector),
    ).toThrow(RangeError);
    expect(() => captureWorld(DEFAULT_WORLD, 1.5, 2)).toThrow(RangeError);
  });
  it("disposes owned original resources even when a renderer replaces them", () => {
    const world = createWorld(DEFAULT_WORLD);
    const originalGeometry = world.object.geometry;
    const originalMaterial = world.object.material;
    const replacementGeometry = new BoxGeometry();
    const replacementMaterial = new MeshBasicMaterial();
    const events: string[] = [];
    originalGeometry.addEventListener("dispose", () =>
      events.push("original geometry"),
    );
    originalMaterial.addEventListener("dispose", () =>
      events.push("original material"),
    );
    replacementGeometry.addEventListener("dispose", () =>
      events.push("replacement geometry"),
    );
    replacementMaterial.addEventListener("dispose", () =>
      events.push("replacement material"),
    );
    world.object.geometry = replacementGeometry;
    world.object.material = replacementMaterial;
    world.dispose();
    expect(events.sort()).toEqual(["original geometry", "original material"]);
    replacementGeometry.dispose();
    replacementMaterial.dispose();
  });
  it("parses a validated field-only world config without coercing imported JSON values", () => {
    const source = { ...DEFAULT_WORLD, extra: "discard me" };
    const parsed = parseWorldConfig(source);
    expect(parsed).toEqual(DEFAULT_WORLD);
    expect(parsed).not.toBe(source);
    expect(validateWorldConfig(parsed)).toBeUndefined();
    for (const bad of [
      null,
      [],
      "text",
      {},
      { ...DEFAULT_WORLD, seed: "42" },
      { ...DEFAULT_WORLD, x: undefined },
      { ...DEFAULT_WORLD, shape: 1 },
      { ...DEFAULT_WORLD, cameraFov: Infinity },
      { ...DEFAULT_WORLD, y: 2.51 },
    ])
      expect(() => parseWorldConfig(bad)).toThrow(RangeError);
    const inheritedShape = Object.assign(
      Object.create({ shape: "sphere" }),
      DEFAULT_WORLD,
    );
    delete inheritedShape.shape;
    expect(() => parseWorldConfig(inheritedShape)).toThrow(RangeError);
    for (const key of Object.keys(DEFAULT_WORLD)) {
      const missing: Record<string, unknown> = { ...DEFAULT_WORLD };
      delete missing[key];
      expect(() => parseWorldConfig(missing)).toThrow(RangeError);
    }
  });
  it("reports tiny optical-depth RMSE and all-pixel coverage in the default benchmark", () => {
    const started = performance.now();
    const { capture, reconstruction, metrics } = runWorldScan(DEFAULT_WORLD);
    expect(metrics.totalCount).toBe(96 * 72);
    expect(metrics.validCount).toBe(reconstruction.validCount);
    expect(metrics.validCount).toBeGreaterThan(1000);
    expect(metrics.cameraHitCount).toBe(
      capture.cameraHit.reduce((sum, v) => sum + v, 0),
    );
    expect(metrics.occludedCount).toBe(
      capture.shadowMask.reduce((sum, v) => sum + v, 0),
    );
    expect(metrics.evaluatedCount).toBe(metrics.validCount);
    expect(metrics.validRatio).toBe(metrics.validCount / metrics.totalCount);
    expect(metrics.rmseDepth).not.toBeNull();
    expect(metrics.rmseDepth!).toBeLessThan(1e-10);
    expect(reconstruction.depth).not.toBe(capture.truthDepth);
    console.info(
      "Default 96x72 CPU scan benchmark",
      JSON.stringify({ ...metrics, milliseconds: performance.now() - started }),
    );
  });
  it("inverts independently generated intensities into selected points without a mesh or truth", () => {
    const camera = {
      ...makePinhole([0, 0, 0], [0, 0, -1], 3, 1, 45),
      fx: 100,
      fy: 100,
    };
    const projector = makePinhole([1, 0.2, 0], [0, 0, -5], 160, 120, 55);
    const points: Vec3[] = [
      [-0.03, 0, -3],
      [0, 0, -5],
      [0.07, 0, -7],
    ];
    const frames: [Float64Array, Float64Array, Float64Array] = [
      new Float64Array(3),
      new Float64Array(3),
      new Float64Array(3),
    ];
    points.forEach((point, i) => {
      const u = projectPoint(projector, point)!.u;
      const phi = (TAU * (u + 0.5)) / projector.width - Math.PI;
      frames.forEach((frame, k) => {
        frame[i] = 0.5 + 0.2 * Math.cos(phi + SHIFTS[k]);
      });
    });
    const inverse = reconstructCaptures(
      { width: 3, height: 1, frames, clipped: new Uint8Array(3) },
      camera,
      projector,
    );
    expect(inverse.validCount).toBe(3);
    points.forEach((point, i) => {
      expect(inverse.depth[i]).toBeCloseTo(-point[2], 10);
      point.forEach((v, axis) =>
        expect(inverse.points[i * 3 + axis]).toBeCloseTo(v, 10),
      );
    });
  });
  it("adds reproducible independent Gaussian noise only when enabled", () => {
    const config = { ...DEFAULT_WORLD, noiseSigma: 0.01 };
    const a = captureWorld(config, 32, 24);
    const b = captureWorld(config, 32, 24);
    const c = captureWorld({ ...config, seed: 43 }, 32, 24);
    const ideal = captureWorld({ ...config, noiseSigma: 0 }, 32, 24);
    expect(a.frames).toEqual(b.frames);
    expect(a.frames).not.toEqual(c.frames);
    expect(a.frames).not.toEqual(ideal.frames);
    const residuals = a.frames.flatMap((frame, k) =>
      Array.from(frame, (v, i) => v - ideal.frames[k][i]),
    );
    const mean = residuals.reduce((sum, v) => sum + v, 0) / residuals.length;
    const sigma = Math.sqrt(
      residuals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / residuals.length,
    );
    expect(Math.abs(mean)).toBeLessThan(0.001);
    expect(sigma).toBeGreaterThan(0.009);
    expect(sigma).toBeLessThan(0.011);
    expect(
      a.frames.every((frame) => frame.every((v) => v >= 0 && v <= 1)),
    ).toBe(true);
    expect(a.truthDepth).toEqual(ideal.truthDepth);
  });
  it("captures the analytic ground illumination through three shifted full-FoV patterns", () => {
    const config = { ...DEFAULT_WORLD, x: -2 };
    const capture = captureWorld(config);
    const { camera, projector } = getRig(config);
    const x = 60,
      y = 60,
      i = y * capture.width + x;
    const direction = cameraRay(camera, x, y);
    const distance = -camera.position[1] / direction[1];
    const point = direction.map(
      (v, axis) => camera.position[axis] + v * distance,
    ) as [number, number, number];
    const pp = projectPoint(projector, point)!;
    const projectorDistance = Math.hypot(
      ...point.map((v, axis) => projector.position[axis] - v),
    );
    const lambert = projector.position[1] / projectorDistance;
    const phi = (TAU * (pp.u + 0.5)) / projector.width - Math.PI;
    expect(capture.cameraHit[i]).toBe(1);
    expect(capture.shadowMask[i]).toBe(0);
    expect(capture.truthDepth[i]).toBeCloseTo(
      projectPoint(camera, point)!.depth,
      11,
    );
    expect(capture.truthDepth[i]).not.toBeCloseTo(distance, 3);
    const rho = config.groundAlbedo;
    for (let k = 0; k < 3; k++)
      expect(capture.frames[k][i]).toBeCloseTo(
        0.12 + rho * lambert * (0.4 + 0.36 * Math.cos(phi + SHIFTS[k])),
        11,
      );
    const phase = decodeNStep(capture.frames, 0.01, capture.clipped);
    expect(phase.wrapped[i]).toBeCloseTo(phi, 11);
    expect(phase.modulation[i]).toBeCloseTo(0.36 * rho * lambert, 11);
  });
  it("rejects invalid world parameters before allocating meshes or rigs", () => {
    for (const config of [
      { ...DEFAULT_WORLD, x: NaN },
      { ...DEFAULT_WORLD, z: 2.01 },
      { ...DEFAULT_WORLD, y: 0.64 },
      { ...DEFAULT_WORLD, cameraZ: -5.01 },
      { ...DEFAULT_WORLD, cameraX: 0, cameraY: 0.6, cameraZ: 0.3 },
      { ...DEFAULT_WORLD, projectorY: 6.01 },
      { ...DEFAULT_WORLD, projectorX: -5.01 },
      { ...DEFAULT_WORLD, grooveAngle: 29 },
      { ...DEFAULT_WORLD, grooveAngle: 151 },
      { ...DEFAULT_WORLD, cameraFov: 76 },
      { ...DEFAULT_WORLD, seed: -1 },
      { ...DEFAULT_WORLD, seed: 1.5 },
      { ...DEFAULT_WORLD, seed: 4294967296 },
      { ...DEFAULT_WORLD, noiseSigma: 0.011 },
      { ...DEFAULT_WORLD, shape: "other" as typeof DEFAULT_WORLD.shape },
    ]) {
      expect(() => createWorld(config)).toThrow(RangeError);
      expect(() => getRig(config)).toThrow(RangeError);
    }
  });
  it("shares exact positioned meshes with the visual world and disposes resources", () => {
    const world = createWorld(DEFAULT_WORLD);
    expect(world.object.geometry.type).toBe("SphereGeometry");
    expect(world.object.position.toArray()).toEqual([0, 0.75, 0]);
    expect(world.ground.rotation.x).toBe(-Math.PI / 2);
    expect(world.meshes).toEqual([world.object, world.ground]);
    expect(world.object.matrixWorld.elements[13]).toBe(0.75);
    const events: string[] = [];
    for (const mesh of world.meshes) {
      mesh.geometry.addEventListener("dispose", () => events.push("geometry"));
      mesh.material.addEventListener("dispose", () => events.push("material"));
    }
    world.dispose();
    expect(events.sort()).toEqual([
      "geometry",
      "geometry",
      "material",
      "material",
    ]);
    const { camera, projector } = getRig(DEFAULT_WORLD);
    expect(camera.position).toEqual([0, 3.5, 0]);
    expect([camera.width, camera.height]).toEqual([96, 72]);
    expect(projector.position).toEqual([2.5, 0.75, 0]);
    expect([projector.width, projector.height]).toEqual([160, 120]);
  });
  it("builds a closed V-groove whose opening angle is adjustable and reconstructs both walls", () => {
    const floors = [30, 90, 150].map((grooveAngle) => {
      const world = createWorld({
        ...DEFAULT_WORLD,
        shape: "vgroove",
        grooveAngle,
      });
      try {
        world.object.geometry.computeBoundingBox();
        const box = world.object.geometry.boundingBox!;
        [-0.8, -0.4, -0.6].forEach((v, axis) =>
          expect(box.min.getComponent(axis)).toBeCloseTo(v, 6),
        );
        [0.8, 0.4, 0.6].forEach((v, axis) =>
          expect(box.max.getComponent(axis)).toBeCloseTo(v, 6),
        );
        // Probe straight down through the groove centre to find its floor.
        const hit = new Raycaster(
          new Vector3(0, 5, 0),
          new Vector3(0, -1, 0),
        ).intersectObject(world.object)[0];
        return hit.point.y;
      } finally {
        world.dispose();
      }
    });
    expect(floors[0]).toBeCloseTo(0.75 + 0.4 - 0.6, 6);
    expect(floors[1]).toBeCloseTo(0.75 + 0.4 - 0.6, 6);
    expect(floors[2]).toBeCloseTo(
      0.75 + 0.4 - 0.7 / Math.tan((75 * Math.PI) / 180),
      6,
    );
    // A side-and-above rig: the default side projector sits below the groove rim.
    const scan = runWorldScan(
      {
        ...DEFAULT_WORLD,
        shape: "vgroove",
        cameraX: -1,
        cameraY: 1.8,
        cameraZ: 4,
        projectorX: 1,
        projectorY: 2.3,
        projectorZ: 3.5,
      },
      96,
      72,
    );
    expect(scan.metrics.rmseDepth!).toBeLessThan(1e-10);
    let left = 0,
      right = 0;
    for (let i = 0; i < scan.reconstruction.valid.length; i++) {
      if (!scan.reconstruction.valid[i]) continue;
      const [px, py, pz] = scan.reconstruction.points.subarray(
        3 * i,
        3 * i + 3,
      );
      if (Math.abs(pz) > 0.55 || py < 0.6 || py > 1.14) continue;
      if (px < -0.02 && px > -0.6) left++;
      if (px > 0.02 && px < 0.6) right++;
    }
    // The left-side camera sees the left wall at a grazing angle.
    expect(left).toBeGreaterThan(5);
    expect(right).toBeGreaterThan(left);
  });
  it("places camera and projector at configured positions, aimed at the object centre", () => {
    const config = {
      ...DEFAULT_WORLD,
      x: 0.4,
      z: -0.3,
      cameraX: 2.5,
      cameraY: 3,
      cameraZ: 2,
      projectorX: -3,
      projectorY: 1.2,
      projectorZ: 5,
    };
    const { camera, projector } = getRig(config);
    expect(camera.position).toEqual([2.5, 3, 2]);
    expect(projector.position).toEqual([-3, 1.2, 5]);
    for (const device of [camera, projector]) {
      const target = projectPoint(device, [0.4, 0.75, -0.3])!;
      expect(target.u).toBeCloseTo(device.cx, 10);
      expect(target.v).toBeCloseTo(device.cy, 10);
    }
    // Image right lies along the baseline component perpendicular to each axis.
    const baseline = [-5.5, -1.8, 3];
    for (const device of [camera, projector]) {
      const along = baseline.reduce((s, v, a) => s + v * device.right[a], 0);
      const up = baseline.reduce((s, v, a) => s + v * device.up[a], 0);
      expect(along).toBeGreaterThan(0);
      expect(Math.abs(up)).toBeLessThan(1e-12);
    }
    const moved = runWorldScan(config, 48, 36);
    expect(moved.capture.frames).not.toEqual(
      runWorldScan(DEFAULT_WORLD, 48, 36).capture.frames,
    );
    expect(moved.metrics.validCount).toBeGreaterThan(100);
    expect(moved.metrics.rmseDepth!).toBeLessThan(1e-10);
  });
  it("allows devices directly overhead and on the far side of the object", () => {
    for (const placement of [
      { cameraX: 0, cameraY: 5, cameraZ: 0 },
      { cameraX: 0.5, cameraY: 2, cameraZ: -4 },
      { projectorX: 0, projectorY: 4.5, projectorZ: 0 },
    ]) {
      const scan = runWorldScan({ ...DEFAULT_WORLD, ...placement }, 48, 36);
      expect(scan.metrics.validCount).toBeGreaterThan(100);
      expect(scan.metrics.rmseDepth!).toBeLessThan(1e-10);
    }
  });
  it("keeps the ideal direct-only pipeline when interreflection is off", () => {
    const scan = runWorldScan(DEFAULT_WORLD, 32, 24);
    expect(scan.capture.directOnly).toBeNull();
    expect(scan.directReconstruction).toBeNull();
    expect(scan.metrics.directRmseDepth).toBeNull();
    expect(scan.capture.indirect.every((a) => a.every((v) => v === 0))).toBe(
      true,
    );
    scan.capture.frames.forEach((frame, k) =>
      frame.forEach((v, i) => expect(v).toBe(0.12 + scan.capture.direct[k][i])),
    );
  });
  it("adds deterministic interreflection that biases depth inside a V-groove", () => {
    const config = {
      ...DEFAULT_WORLD,
      shape: "vgroove" as const,
      interreflection: true,
      giSamples: 32,
    };
    const a = runWorldScan(config, 32, 24);
    const b = runWorldScan(config, 32, 24);
    expect(a.capture.frames).toEqual(b.capture.frames);
    const indirect = a.capture.indirect[0];
    expect(Math.max(...indirect)).toBeGreaterThan(0.01);
    expect(a.metrics.directRmseDepth!).toBeLessThan(1e-10);
    expect(a.metrics.rmseDepth!).toBeGreaterThan(1e-4);
    a.capture.directOnly!.frames.forEach((frame, k) =>
      frame.forEach((v, i) =>
        expect(v).toBeCloseTo(0.12 + a.capture.direct[k][i], 14),
      ),
    );
    const total = (scan: typeof a) =>
      scan.capture.indirect[0].reduce((s, v) => s + v, 0);
    const twoBounce = runWorldScan({ ...config, bounces: 2 }, 32, 24);
    expect(total(twoBounce)).toBeGreaterThan(total(a) * 1.05);
    const black = runWorldScan(
      { ...config, objectAlbedo: 0, groundAlbedo: 0 },
      32,
      24,
    );
    expect(black.capture.indirect.every((f) => f.every((v) => v === 0))).toBe(
      true,
    );
    expect(black.capture.frames[0].every((v) => v === 0.12)).toBe(true);
  });
  it("renders a glossy highlight only when the specular lobe is enabled", () => {
    // Camera mirrors the projector about the ground so the highlight sits at (0,0,1.2).
    const mirrored = {
      ...DEFAULT_WORLD,
      cameraX: -1.5,
      cameraY: 4,
      cameraZ: 1.2,
      projectorX: 1.5,
      projectorY: 4,
      projectorZ: 1.2,
    };
    const matte = captureWorld(mirrored, 48, 36);
    const glossy = captureWorld(
      { ...mirrored, groundSpecular: 0.6, groundRoughness: 0.2 },
      48,
      36,
    );
    const peak = (c: typeof matte) => Math.max(...c.direct[0]);
    expect(peak(glossy)).toBeGreaterThan(peak(matte) * 5);
    expect(glossy.clipped.some((v) => v === 1)).toBe(true);
  });
  it("offers material presets that are valid for both object and ground", () => {
    const ids = new Set(MATERIAL_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(MATERIAL_PRESETS.length);
    for (const p of MATERIAL_PRESETS)
      expect(() =>
        validateWorldConfig({
          ...DEFAULT_WORLD,
          objectAlbedo: p.albedo,
          objectSpecular: p.specular,
          objectRoughness: p.roughness,
          groundAlbedo: p.albedo,
          groundSpecular: p.specular,
          groundRoughness: p.roughness,
        }),
      ).not.toThrow();
    const matches = (albedo: number, specular: number, roughness: number) =>
      MATERIAL_PRESETS.some(
        (p) =>
          p.albedo === albedo &&
          p.specular === specular &&
          p.roughness === roughness,
      );
    expect(
      matches(
        DEFAULT_WORLD.objectAlbedo,
        DEFAULT_WORLD.objectSpecular,
        DEFAULT_WORLD.objectRoughness,
      ),
    ).toBe(true);
    expect(
      matches(
        DEFAULT_WORLD.groundAlbedo,
        DEFAULT_WORLD.groundSpecular,
        DEFAULT_WORLD.groundRoughness,
      ),
    ).toBe(true);
  });
});

describe("projector fringe coding", () => {
  it("decodes N-step captures for N = 3…8 exactly like the analytic phase", () => {
    for (let n = 3; n <= 8; n++) {
      const phases = [-3, -1.2, 0, 0.7, 2.9];
      const frames = Array.from({ length: n }, (_, k) =>
        Float64Array.from(phases, (phi) =>
          0.5 + 0.3 * Math.cos(phi + (TAU * k) / n),
        ),
      );
      const result = decodeNStep(frames, 0.01);
      phases.forEach((phi, i) => {
        expect(result.wrapped[i]).toBeCloseTo(phi, 12);
        expect(result.modulation[i]).toBeCloseTo(0.3, 12);
        expect(result.mean[i]).toBeCloseTo(0.5, 12);
      });
    }
  });
  it("lists N shifted frames, plus N unit-frequency frames only when unwrapping a higher frequency", () => {
    const base = { fringeFrequency: 1, phaseSteps: 4, temporalUnwrap: true };
    expect(fringePatterns(base)).toHaveLength(4);
    expect(fringePatterns({ ...base, fringeFrequency: 8 })).toHaveLength(8);
    expect(
      fringePatterns({ ...base, fringeFrequency: 8, temporalUnwrap: false }),
    ).toHaveLength(4);
    expect(
      fringePatterns({ ...base, fringeFrequency: 8 }).map((p) => p.frequency),
    ).toEqual([8, 8, 8, 8, 1, 1, 1, 1]);
    expect(fringePatterns(DEFAULT_WORLD).map((p) => p.shift)).toEqual([
      ...SHIFTS,
    ]);
  });
  it("recovers exact depth at high frequency with temporal unwrapping and fails without it", () => {
    const config = { ...DEFAULT_WORLD, fringeFrequency: 8, phaseSteps: 4 };
    const unwrapped = runWorldScan(config, 48, 36);
    expect(unwrapped.capture.frames).toHaveLength(8);
    expect(unwrapped.reconstruction.lowPhase).not.toBeNull();
    expect(unwrapped.metrics.validCount).toBeGreaterThan(500);
    expect(unwrapped.metrics.rmseDepth!).toBeLessThan(1e-10);
    const orders = new Set<number>();
    unwrapped.reconstruction.valid.forEach((v, i) => {
      if (v)
        orders.add(
          Math.round(
            (unwrapped.reconstruction.absolute[i] -
              unwrapped.reconstruction.phase.wrapped[i]) /
              TAU,
          ),
        );
    });
    expect(orders.size).toBeGreaterThan(1);
    const ambiguous = runWorldScan(
      { ...config, temporalUnwrap: false },
      48,
      36,
    );
    expect(ambiguous.capture.frames).toHaveLength(4);
    expect(ambiguous.reconstruction.lowPhase).toBeNull();
    expect(ambiguous.metrics.rmseDepth!).toBeGreaterThan(0.05);
  });
  it("uses the configured offset, amplitude and projector FoV in the forward model", () => {
    const dim = runWorldScan(
      { ...DEFAULT_WORLD, fringeOffset: 0.3, fringeAmplitude: 0.1 },
      32,
      24,
    );
    const bright = runWorldScan(DEFAULT_WORLD, 32, 24);
    const i = dim.reconstruction.valid.findIndex(
      (v, index) => v === 1 && bright.reconstruction.valid[index] === 1,
    );
    expect(dim.reconstruction.phase.modulation[i]).toBeCloseTo(
      (bright.reconstruction.phase.modulation[i] * 0.1) / 0.36,
      10,
    );
    expect(dim.metrics.rmseDepth!).toBeLessThan(1e-10);
    const narrow = getRig({ ...DEFAULT_WORLD, projectorFov: 30 }).projector;
    expect(narrow.fy).toBeGreaterThan(getRig(DEFAULT_WORLD).projector.fy);
    for (const bad of [
      { fringeOffset: 0.3, fringeAmplitude: 0.31 },
      { fringeOffset: 0.8, fringeAmplitude: 0.25 },
      { fringeFrequency: 1.5 },
      { phaseSteps: 2 },
      { projectorFov: 90 },
      { temporalUnwrap: "yes" as unknown as boolean },
    ])
      expect(() => validateWorldConfig({ ...DEFAULT_WORLD, ...bad })).toThrow(
        RangeError,
      );
  });
});
