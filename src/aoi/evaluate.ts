import * as THREE from "three";
import { errorStats, type ErrorStats } from "../sandbox/analysis";
import { projectPoint, type Pinhole, type Vec3 } from "../sandbox/geometry";
import type { TraceScene } from "../sandbox/lightTransport";
import { insideProjector } from "../sandbox/scanner";
import {
  cellCenter,
  MATERIAL_SLOTS,
  type AoiConfig,
  type AoiDevice,
  type GridSpec,
} from "./rig";
import type { HeightMap, PairReconstruction } from "./reconstruct";
import { NO_SURFACE } from "./scene";
import {
  axisDepth,
  blurDiameter,
  blurSigma,
  CAMERA_BLUR_LIMIT,
  codingRange,
  gaussianMtf,
  heightPer2Pi,
  heightSensitivity,
} from "./sensitivity";

/** Ground truth on the unified grid. Evaluation only: never passed to reconstruction or fusion. */
export interface TruthMap {
  /** Mean height over s×s samples in the cell, NaN where no surface. */
  mean: Float64Array;
  /** Height at the cell centre. */
  center: Float64Array;
  /** max − min over the samples: large values mark edges / slopes. */
  range: Float64Array;
  /** Material slot at the cell centre. */
  slot: Uint8Array;
  /** Surface normal at the cell centre. */
  normal: Float64Array;
}

export function buildTruthMap(
  scene: TraceScene,
  grid: GridSpec,
  samples = 3,
): TruthMap {
  const cells = grid.nx * grid.ny;
  const truth: TruthMap = {
    mean: new Float64Array(cells).fill(NaN),
    center: new Float64Array(cells).fill(NaN),
    range: new Float64Array(cells).fill(NaN),
    slot: new Uint8Array(cells).fill(NO_SURFACE),
    normal: new Float64Array(3 * cells),
  };
  const origin = new THREE.Vector3(),
    down = new THREE.Vector3(0, -1, 0),
    top = 1000;
  for (let c = 0; c < cells; c++) {
    const [x, y] = cellCenter(grid, c);
    const centre = scene.trace(origin.set(x, top, y), down);
    if (!centre) continue;
    truth.center[c] = centre.point.y;
    truth.slot[c] = centre.mesh;
    // Faces hit from above must face up; flip any inward winding defensively.
    const n =
      centre.normal.y < 0 ? centre.normal.clone().negate() : centre.normal;
    truth.normal.set([n.x, n.y, n.z], 3 * c);
    let sum = 0,
      lo = Infinity,
      hi = -Infinity,
      hits = 0;
    for (let sy = 0; sy < samples; sy++)
      for (let sx = 0; sx < samples; sx++) {
        const hit = scene.trace(
          origin.set(
            x + ((sx + 0.5) / samples - 0.5) * grid.cellSize,
            top,
            y + ((sy + 0.5) / samples - 0.5) * grid.cellSize,
          ),
          down,
        );
        if (!hit) continue;
        sum += hit.point.y;
        lo = Math.min(lo, hit.point.y);
        hi = Math.max(hi, hit.point.y);
        hits++;
      }
    truth.mean[c] = hits ? sum / hits : centre.point.y;
    truth.range[c] = hits ? hi - lo : 0;
  }
  return truth;
}

/** Per-cell outcome; the first four are measured cells. */
export const REASONS = [
  ["ok", "準確（≤ 容許誤差）", "#5ee4bd"],
  ["inaccurate", "有值但超出容許誤差", "#e8d36a"],
  ["edgeMix", "邊緣混合（格內真值起伏）", "#9ab0ff"],
  ["orderError", "條紋級次錯誤（unwrap 失敗）", "#ff5c8a"],
  ["rangeAlias", "超出量測範圍（混疊）", "#c04bff"],
  ["outsideCamera", "Camera FOV 外", "#3b4a5c"],
  ["cameraOccluded", "Camera 視線被遮擋", "#6b5233"],
  ["outsideProjector", "Projector FOV 外", "#2f5d7c"],
  ["shadow", "Projector 陰影", "#1c2a3a"],
  ["saturated", "亮度飽和", "#ffffff"],
  ["defocus", "失焦導致調變不足", "#f29b4b"],
  ["lowModulation", "條紋調變不足", "#b5653a"],
  ["notSampled", "已解碼但無重建點落入此格", "#7d8da0"],
  ["noSurface", "無表面", "#0b121c"],
] as const;
export type Reason = (typeof REASONS)[number][0];
export const REASON_INDEX = Object.fromEntries(
  REASONS.map(([key], i) => [key, i]),
) as Record<Reason, number>;
export const MEASURED_REASONS = 5;

/** The error is explained by height variation inside the cell (step edge, slope), not by decoding. */
const edgeExplained = (
  error: number,
  truth: TruthMap,
  cell: number,
  tolerance: number,
) => truth.range[cell] >= Math.abs(error) - tolerance;

export interface HeightScore {
  surfaceCells: number;
  measuredCells: number;
  accurateCells: number;
  /** measured / surface cells. */
  coverage: number;
  /** 1 − accurate / surface cells: missing or wrong. */
  failureRatio: number;
  /** |error| ≥ half a fine fringe period of height (wrong fringe order or alias), edges excluded. */
  grossCells: number;
  stats: ErrorStats | null;
  /** Cells whose truth varies less than 2·tolerance inside the cell. */
  flatStats: ErrorStats | null;
  bySlot: {
    slot: number;
    cells: number;
    measured: number;
    accurate: number;
    stats: ErrorStats | null;
  }[];
}

/** Score any height map (pair or fusion) in world coordinates against the truth. */
export function scoreHeightMap(
  height: Float64Array,
  truth: TruthMap,
  tolerance: number,
  grossThreshold: number,
): HeightScore & { errors: Float64Array } {
  const cells = height.length;
  const errors = new Float64Array(cells).fill(NaN);
  let surfaceCells = 0,
    measuredCells = 0,
    accurateCells = 0,
    grossCells = 0;
  const flat: number[] = [];
  const slots = MATERIAL_SLOTS.map((_, slot) => ({
    slot,
    cells: 0,
    measured: 0,
    accurate: 0,
    own: [] as number[],
  }));
  for (let c = 0; c < cells; c++) {
    if (truth.slot[c] === NO_SURFACE) continue;
    surfaceCells++;
    const group = slots[truth.slot[c]];
    group.cells++;
    if (!Number.isFinite(height[c])) continue;
    const e = height[c] - truth.mean[c];
    errors[c] = e;
    measuredCells++;
    group.measured++;
    group.own.push(e);
    if (Math.abs(e) <= tolerance) {
      accurateCells++;
      group.accurate++;
    }
    if (Math.abs(e) >= grossThreshold && !edgeExplained(e, truth, c, tolerance))
      grossCells++;
    if (truth.range[c] < 2 * tolerance) flat.push(e);
  }
  return {
    errors,
    surfaceCells,
    measuredCells,
    accurateCells,
    coverage: surfaceCells ? measuredCells / surfaceCells : 0,
    failureRatio: surfaceCells ? 1 - accurateCells / surfaceCells : 1,
    grossCells,
    stats: errorStats(errors),
    flatStats: errorStats(flat),
    bySlot: slots
      .filter((g) => g.cells)
      .map(({ own, ...g }) => ({ ...g, stats: errorStats(own) })),
  };
}

export interface PairEvaluation extends HeightScore {
  reasons: Uint8Array;
  reasonCounts: number[];
  errors: Float64Array;
}

/**
 * Explain every cell of one pair. Geometric reasons use the truth surface point
 * (that is why this is evaluation-only); decode reasons read the pair's own pixels.
 */
export function evaluatePair(
  scene: TraceScene,
  grid: GridSpec,
  truth: TruthMap,
  map: HeightMap,
  reconstruction: Pick<PairReconstruction, "decoded">,
  clipped: Uint8Array,
  camera: Pinhole,
  projector: Pinhole,
  cameraDevice: AoiDevice,
  projectorDevice: AoiDevice,
  config: AoiConfig,
): PairEvaluation {
  const f1 = config.fringeFrequency,
    cells = grid.nx * grid.ny;
  const reasons = new Uint8Array(cells);
  const direction = new THREE.Vector3(),
    origin = new THREE.Vector3();
  const blocked = (from: Vec3, to: Vec3) => {
    origin.fromArray(from);
    direction.fromArray(to).sub(origin);
    const distance = direction.length();
    direction.divideScalar(distance);
    return !!scene.trace(
      origin,
      direction,
      0,
      distance - 1e-4 * Math.max(1, distance),
    );
  };
  const facing = (c: number, from: Vec3, to: Vec3) =>
    truth.normal[3 * c] * (from[0] - to[0]) +
      truth.normal[3 * c + 1] * (from[1] - to[1]) +
      truth.normal[3 * c + 2] * (from[2] - to[2]) >
    0;
  const score = scoreHeightMap(map.height, truth, config.tolerance, Infinity);
  let gross = 0;
  for (let c = 0; c < cells; c++) {
    if (truth.slot[c] === NO_SURFACE) {
      reasons[c] = REASON_INDEX.noSurface;
      continue;
    }
    const [x, y] = cellCenter(grid, c);
    const t: Vec3 = [x, truth.center[c], y];
    const e = score.errors[c];
    if (Number.isFinite(e)) {
      const per2Pi = heightPer2Pi(heightSensitivity(camera, projector, f1, t));
      if (Math.abs(e) <= config.tolerance) reasons[c] = REASON_INDEX.ok;
      else if (edgeExplained(e, truth, c, config.tolerance))
        reasons[c] = REASON_INDEX.edgeMix;
      else if (Math.abs(e) < per2Pi / 2) reasons[c] = REASON_INDEX.inaccurate;
      else {
        gross++;
        const range = codingRange(per2Pi, config);
        const inside =
          config.coding === "temporal" ||
          (truth.mean[c] >= config.windowBottom &&
            truth.mean[c] < config.windowBottom + range);
        reasons[c] = inside ? REASON_INDEX.orderError : REASON_INDEX.rangeAlias;
      }
      continue;
    }
    const pc = projectPoint(camera, t);
    if (
      !pc ||
      pc.u < -0.5 ||
      pc.u >= camera.width - 0.5 ||
      pc.v < -0.5 ||
      pc.v >= camera.height - 0.5
    )
      reasons[c] = REASON_INDEX.outsideCamera;
    else if (!facing(c, camera.position, t) || blocked(camera.position, t))
      reasons[c] = REASON_INDEX.cameraOccluded;
    else if (!insideProjector(projector, projectPoint(projector, t)))
      reasons[c] = REASON_INDEX.outsideProjector;
    else if (
      !facing(c, projector.position, t) ||
      blocked(projector.position, t)
    )
      reasons[c] = REASON_INDEX.shadow;
    else {
      const pixel =
        Math.min(camera.height - 1, Math.round(pc.v)) * camera.width +
        Math.min(camera.width - 1, Math.round(pc.u));
      if (clipped[pixel]) reasons[c] = REASON_INDEX.saturated;
      else if (!reconstruction.decoded[pixel]) {
        const pp = projectPoint(projector, t)!;
        const projectorBlur = blurSigma(
            blurDiameter(
              projector.fx,
              projectorDevice.aperture,
              pp.depth,
              axisDepth(projectorDevice, config.focusHeight),
            ),
          ),
          cameraBlur = blurDiameter(
            camera.fx,
            cameraDevice.aperture,
            pc.depth,
            axisDepth(cameraDevice, config.focusHeight),
          );
        const defocused =
          config.defocus &&
          (gaussianMtf(projectorBlur, projector.width / f1) < 0.5 ||
            cameraBlur > CAMERA_BLUR_LIMIT);
        reasons[c] = defocused
          ? REASON_INDEX.defocus
          : REASON_INDEX.lowModulation;
      } else reasons[c] = REASON_INDEX.notSampled;
    }
  }
  const reasonCounts = REASONS.map(() => 0);
  for (const r of reasons) reasonCounts[r]++;
  return { ...score, grossCells: gross, reasons, reasonCounts };
}
