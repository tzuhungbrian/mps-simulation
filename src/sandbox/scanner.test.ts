import { MeshBasicMaterial, BoxGeometry, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  DEFAULT_WORLD,
  getRig,
  captureWorld,
  reconstructCaptures,
  runWorldScan,
  parseWorldConfig,
  validateWorldConfig,
} from "./scanner";
import { cameraRay, makePinhole, projectPoint, type Vec3 } from "./geometry";
import { decodeThreeStep, SHIFTS, TAU } from "../core/simulation";

describe("CPU calibrated scanner", () => {
  it("reports null RMSE when a one-pixel scan sees an unilluminated surface", () => {
    const result = runWorldScan(
      { ...DEFAULT_WORLD, baseline: 3, x: 0.5, z: -1 },
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
    const { capture, reconstruction, camera, projector } =
      runWorldScan(DEFAULT_WORLD);
    const world = createWorld(DEFAULT_WORLD);
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
    for (const shape of ["sphere", "box", "ramp"] as const) {
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
    for (let k = 0; k < 3; k++)
      expect(capture.frames[k][i]).toBeCloseTo(
        0.12 + 0.4 * lambert + 0.36 * lambert * Math.cos(phi + SHIFTS[k]),
        11,
      );
    const phase = decodeThreeStep(capture.frames, 0.01, capture.clipped);
    expect(phase.wrapped[i]).toBeCloseTo(phi, 11);
    expect(phase.modulation[i]).toBeCloseTo(0.36 * lambert, 11);
  });
  it("rejects invalid world parameters before allocating meshes or rigs", () => {
    for (const config of [
      { ...DEFAULT_WORLD, x: NaN },
      { ...DEFAULT_WORLD, z: 2.01 },
      { ...DEFAULT_WORLD, y: 0.64 },
      { ...DEFAULT_WORLD, baseline: 0.39 },
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
    expect(camera.position).toEqual([-1, 1.8, 4]);
    expect([camera.width, camera.height]).toEqual([96, 72]);
    expect(projector.position).toEqual([1, 2.3, 3.5]);
    expect([projector.width, projector.height]).toEqual([160, 120]);
  });
});
