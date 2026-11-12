import { describe, expect, it } from "vitest";
import {
  cameraRay,
  makePinhole,
  projectPoint,
  triangulateColumn,
} from "./geometry";

describe("calibrated pinholes", () => {
  it("triangulates analytic rectified depth 5 from a projector column", () => {
    const camera = makePinhole([0, 0, 0], [0, 0, -1], 200, 200, 90);
    const projector = makePinhole([1, 0, 0], [1, 0, -1], 200, 200, 90);
    // fx=100, disparity=20 => optical depth=5, independent of world mesh.
    const point = triangulateColumn(camera, projector, 99.5, 99.5, 79.5);
    expect(point?.[0]).toBeCloseTo(0, 12);
    expect(point?.[1]).toBeCloseTo(0, 12);
    expect(point?.[2]).toBeCloseTo(-5, 12);
  });
  it("recovers independent off-axis world points and rejects parallel/behind rays", () => {
    const camera = makePinhole([-1, 1.8, 4], [0, 0.4, 0], 96, 72, 45);
    const projector = makePinhole([1, 2.3, 3.5], [0, 0.4, 0], 160, 120, 55);
    for (const point of [
      [0, 0.8, 0],
      [0.7, 0.2, -0.3],
      [-0.4, 1, 0.5],
    ] as [number, number, number][]) {
      const cp = projectPoint(camera, point)!;
      const pp = projectPoint(projector, point)!;
      const result = triangulateColumn(camera, projector, cp.u, cp.v, pp.u)!;
      result.forEach((value, axis) =>
        expect(value).toBeCloseTo(point[axis], 11),
      );
    }
    const a = makePinhole([0, 0, 0], [0, 0, -1], 200, 200, 90);
    const b = makePinhole([1, 0, 0], [1, 0, -1], 200, 200, 90);
    expect(triangulateColumn(a, b, a.cx, a.cy, b.cx)).toBeNull();
    expect(triangulateColumn(a, b, a.cx, a.cy, b.cx + 20)).toBeNull();
    expect(triangulateColumn(a, b, NaN, a.cy, b.cx)).toBeNull();
    expect(
      triangulateColumn(a, { ...b, forward: [0, 0, 1] }, a.cx, a.cy, b.cx + 20),
    ).toBeNull();
    expect(projectPoint(a, [Infinity, 0, -1])).toBeNull();
    expect(projectPoint(a, [0, 0, 0])).toBeNull();
    expect(() => makePinhole([0, 0, 0], [0, 0, 0], 100, 100, 45)).toThrow(
      RangeError,
    );
    for (const target of [
      [0, -2, 0],
      [0, 3, 0],
    ] as [number, number, number][]) {
      const vertical = makePinhole([0, 0, 0], target, 100, 100, 45);
      expect(Math.hypot(...vertical.right)).toBeCloseTo(1, 14);
      expect(Math.hypot(...vertical.up)).toBeCloseTo(1, 14);
      const centre = projectPoint(vertical, target)!;
      expect(centre.u).toBeCloseTo(vertical.cx, 12);
      expect(centre.v).toBeCloseTo(vertical.cy, 12);
    }
  });

  it("uses integer pixel centers and a normalized world ray", () => {
    const camera = makePinhole([0, 0, 0], [0, 0, -1], 200, 100, 90);
    expect(camera.cx).toBe(99.5);
    expect(camera.cy).toBe(49.5);
    expect(camera.fx).toBeCloseTo(50, 12);
    expect(camera.fy).toBeCloseTo(50, 12);
    expect(camera.right).toEqual([1, -0, 0]);
    expect(camera.up).toEqual([0, 1, 0]);
    const ray = cameraRay(camera, 110, 35);
    expect(Math.hypot(...ray)).toBeCloseTo(1, 14);
    const projected = projectPoint(
      camera,
      ray.map((v) => v * 5) as [number, number, number],
    );
    expect(projected?.u).toBeCloseTo(110, 12);
    expect(projected?.v).toBeCloseTo(35, 12);
    expect(projectPoint(camera, [0, 0, 1])).toBeNull();
  });
});
