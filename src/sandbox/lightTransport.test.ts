import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createSeededRandom } from "../core/simulation";
import {
  evaluateBrdf,
  sampleBrdf,
  type SurfaceMaterial,
} from "./lightTransport";

const normal = new Vector3(0, 1, 0);
const wo = new Vector3(0.4, 0.8, -0.2).normalize();

/** ∫ f·cos dω via uniform hemisphere sampling, independent of sampleBrdf's pdf. */
function uniformAlbedo(m: SurfaceMaterial, n: number, seed: number) {
  const random = createSeededRandom(seed),
    wi = new Vector3();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const z = random(),
      r = Math.sqrt(1 - z * z),
      phi = 2 * Math.PI * random();
    wi.set(r * Math.cos(phi), z, r * Math.sin(phi));
    sum += evaluateBrdf(m, normal, wi, wo) * z * 2 * Math.PI;
  }
  return sum / n;
}
function importanceAlbedo(m: SurfaceMaterial, n: number, seed: number) {
  const random = createSeededRandom(seed),
    wi = new Vector3();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sampleBrdf(m, normal, wo, random, wi);
  return sum / n;
}

describe("Lambert + GGX BRDF", () => {
  it("returns exactly the albedo for every cosine-weighted diffuse sample", () => {
    const m = { albedo: 0.7, specular: 0, roughness: 0.5 };
    const random = createSeededRandom(1),
      wi = new Vector3();
    for (let i = 0; i < 200; i++)
      expect(sampleBrdf(m, normal, wo, random, wi)).toBeCloseTo(0.7, 12);
  });
  it("is reciprocal and zero below the surface", () => {
    const m = { albedo: 0.6, specular: 0.4, roughness: 0.35 };
    const wi = new Vector3(-0.3, 0.5, 0.6).normalize();
    expect(evaluateBrdf(m, normal, wi, wo)).toBeCloseTo(
      evaluateBrdf(m, normal, wo, wi),
      12,
    );
    expect(evaluateBrdf(m, normal, new Vector3(0, -1, 0), wo)).toBe(0);
  });
  it("importance sampling agrees with uniform sampling and conserves energy", () => {
    for (const m of [
      { albedo: 0.8, specular: 0.3, roughness: 0.5 },
      { albedo: 0, specular: 1, roughness: 0.4 },
      { albedo: 0.5, specular: 0.7, roughness: 0.9 },
    ]) {
      const uniform = uniformAlbedo(m, 400_000, 7);
      const importance = importanceAlbedo(m, 100_000, 9);
      expect(importance).toBeLessThanOrEqual(1.02);
      expect(Math.abs(importance - uniform) / uniform).toBeLessThan(0.03);
    }
  });
});
