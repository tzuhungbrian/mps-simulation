import { describe, expect, it } from "vitest";
import {
  parseParameters,
  serializeParameters,
  saveParameters,
  loadParameters,
  createCsv,
  STORAGE_KEY,
} from "./io";
import { runSimulation, type SimulationConfig } from "../core/simulation";
const config: SimulationConfig = {
  width: 32,
  height: 1,
  frequency: 2,
  phaseOffset: 0.6,
  mean: 0.5,
  amplitude: 0.4,
  noiseSigma: 0,
  minModulation: 0.02,
  seed: 42,
};
describe("portable parameter persistence", () => {
  it("exports every pixel with provenance and actual captures, leaving invalid estimates blank", () => {
    const cfg = { ...config, height: 2, amplitude: 0 };
    const result = runSimulation(cfg);
    const csv = createCsv(cfg, result);
    expect(csv).toContain(
      "# model=three-step-1d; units=rad; unwrap=relative-per-contiguous-row-segment",
    );
    expect(csv).toContain("# config=" + JSON.stringify(cfg));
    const lines = csv
      .split("\r\n")
      .filter((line) => line && !line.startsWith("#"));
    expect(lines).toHaveLength(cfg.width * cfg.height + 1);
    expect(lines[0]).toBe(
      "x,y,I1,I2,I3,estimated_mean,estimated_modulation,wrapped_rad,unwrapped_relative_rad,reference_phase_rad,valid,clipped",
    );
    const first = lines[1].split(",");
    expect(first.slice(0, 5)).toEqual(["0", "0", "0.5", "0.5", "0.5"]);
    expect(first[7]).toBe("");
    expect(first[8]).toBe("");
    expect(first[10]).toBe("0");
    expect(lines.at(-1)!.split(",").slice(0, 2)).toEqual(["31", "1"]);
    expect(csv).not.toMatch(/NaN|Infinity/);
  });
  it("saves at the real storage boundary and restores exact data; invalid writes preserve the previous record", () => {
    const entries = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      getItem: (key: string) => entries.get(key) ?? null,
    };
    expect(loadParameters(storage)).toBeNull();
    saveParameters(storage, config);
    expect(loadParameters(storage)).toEqual(config);
    const previous = entries.get(STORAGE_KEY);
    expect(() =>
      saveParameters(storage, { ...config, frequency: NaN }),
    ).toThrow();
    expect(entries.get(STORAGE_KEY)).toBe(previous);
    saveParameters(storage, config);
    expect(entries.get(STORAGE_KEY)).toBe(previous);
    expect(() =>
      saveParameters(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        config,
      ),
    ).toThrow("quota");
  });
  it("round-trips all parameters with explicit schema and model identity", () => {
    const text = serializeParameters(config);
    expect(JSON.parse(text)).toMatchObject({
      schemaVersion: 1,
      model: "three-step-1d",
    });
    expect(parseParameters(text)).toEqual(config);
  });
  it("rejects incompatible schema, incomplete config, nonfinite values, excessive files and wrong model", () => {
    for (const text of [
      "{}",
      "{",
      JSON.stringify({ schemaVersion: 2, model: "three-step-1d", config }),
      JSON.stringify({ schemaVersion: 1, model: "other", config }),
      JSON.stringify({
        schemaVersion: 1,
        model: "three-step-1d",
        config: { ...config, frequency: null },
      }),
      JSON.stringify({
        schemaVersion: 1,
        model: "three-step-1d",
        config: { ...config, width: 8 },
      }),
      " ".repeat(1_048_577),
    ]) {
      expect(() => parseParameters(text)).toThrow();
    }
  });
});
