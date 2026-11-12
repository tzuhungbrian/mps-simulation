import { describe, expect, it } from "vitest";
import { analyzeScan, errorStats, FAILURE_CAUSES } from "./analysis";
import {
  DEFAULT_WORLD,
  PCB_SETUP,
  runWorldScan,
  type WorldConfig,
} from "./scanner";
import { PCB_PINS, SURFACE } from "./pcb";

const pcb = (extra: Partial<WorldConfig> = {}): WorldConfig => ({
  ...DEFAULT_WORLD,
  ...PCB_SETUP,
  ...extra,
});

describe("scan analysis (evaluation only)", () => {
  it("summarises signed errors", () => {
    const s = errorStats([1, -1, 3, NaN])!;
    expect(s.count).toBe(3);
    expect(s.rmse).toBeCloseTo(Math.sqrt(11 / 3), 12);
    expect(s.mae).toBeCloseTo(5 / 3, 12);
    expect(s.bias).toBeCloseTo(1, 12);
    expect(s.median).toBe(1);
    expect(s.max).toBe(3);
    expect(errorStats([NaN])).toBeNull();
  });

  it("accounts for every pixel as valid or exactly one failure cause", () => {
    const scan = runWorldScan(DEFAULT_WORLD, 48, 36);
    const a = analyzeScan(scan, 0.005);
    const failures = FAILURE_CAUSES.reduce((s, [k]) => s + a.causes[k], 0);
    expect(failures + scan.metrics.validCount).toBe(scan.metrics.totalCount);
    expect(a.overall!.count).toBe(scan.metrics.evaluatedCount);
    expect(a.overall!.rmse).toBeCloseTo(scan.metrics.rmseDepth!, 15);
    expect(a.accurate).toBe(scan.metrics.validCount);
    expect(a.histogram.counts.reduce((s, v) => s + v, 0)).toBe(
      a.overall!.count,
    );
    expect(a.bySurface.reduce((s, r) => s + r.visible, 0)).toBe(
      scan.metrics.cameraHitCount,
    );
    expect(a.causes.unlit).toBeGreaterThan(0);
    expect(a.pins).toBeNull();
  });

  it("builds a PCB with uniquely labelled leads on every component", () => {
    expect(PCB_PINS).toHaveLength(48);
    expect(new Set(PCB_PINS.map((p) => p.label)).size).toBe(48);
    expect([...new Set(PCB_PINS.map((p) => p.component))].sort()).toEqual([
      "C1",
      "C2",
      "J1",
      "R1",
      "U1",
      "U2",
    ]);
  });

  it("reports per-pin success that improves with camera resolution", () => {
    const report = (cameraWidth: number) => {
      const a = analyzeScan(
        runWorldScan(pcb({ cameraWidth })),
        0.005,
        PCB_PINS,
      );
      return a.pins!.filter((p) => p.status === "success").length;
    };
    const coarse = report(96),
      fine = report(384);
    expect(fine).toBeGreaterThan(coarse);
    expect(fine).toBeGreaterThan(PCB_PINS.length / 2);
  });

  it("point sampling reconstructs every valid pin pixel exactly; area sampling mixes edges", () => {
    const point = runWorldScan(pcb({ pixelGrid: 1 }), 128, 96);
    const area = runWorldScan(pcb({ pixelGrid: 2 }), 128, 96);
    expect(point.metrics.rmseDepth!).toBeLessThan(1e-10);
    expect(area.metrics.rmseDepth!).toBeGreaterThan(1e-3);
    const pins = analyzeScan(point, 1e-6, PCB_PINS).pins!;
    for (const p of pins) expect(p.accurate).toBe(p.valid);
    expect(
      Array.from(point.capture.surface).filter((s) => s === SURFACE.pin).length,
    ).toBeGreaterThan(50);
  });
});
