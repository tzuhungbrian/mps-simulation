import {
  classifyPair,
  foldAzimuth,
  spherical,
  type PairClass,
} from "../sandbox/devices";
import { rigTarget, type WorldConfig } from "../sandbox/scanner";

export {
  PAIR_CLASSES,
  PAIR_CLASS_NAMES,
  type PairClass,
} from "../sandbox/devices";

/**
 * Multi-view geometry on the shared sandbox world (mm). Board coordinates:
 * x = world X, y = world Z; heights are world Y and are reported relative to
 * config.referenceHeight.
 */
export interface PairInfo {
  id: string;
  cameraId: string;
  projectorId: string;
  cameraIndex: number;
  projectorIndex: number;
  kind: PairClass;
  /** |Δazimuth| folded into [0°, 180°]. */
  deltaAzimuth: number;
  cameraTilt: number;
  projectorTilt: number;
}

export function enumeratePairs(config: WorldConfig): PairInfo[] {
  const aim = rigTarget(config);
  const pairs: PairInfo[] = [];
  config.cameras.forEach((camera, cameraIndex) => {
    const c = spherical(camera, aim);
    config.projectors.forEach((projector, projectorIndex) => {
      const p = spherical(projector, aim);
      pairs.push({
        id: `${camera.id}-${projector.id}`,
        cameraId: camera.id,
        projectorId: projector.id,
        cameraIndex,
        projectorIndex,
        kind: classifyPair(
          c.tilt,
          c.azimuth,
          p.azimuth,
          config.directTiltLimit,
        ),
        deltaAzimuth: foldAzimuth(c.azimuth, p.azimuth),
        cameraTilt: c.tilt,
        projectorTilt: p.tilt,
      });
    });
  });
  return pairs;
}

export interface GridSpec {
  nx: number;
  ny: number;
  cellSize: number;
  /** Board x/y of the lower corner of cell (0, 0). */
  x0: number;
  y0: number;
}
/** Unified board-plane grid shared by every pair, truth and fusion, centred on the aim point. */
export function makeGrid(config: WorldConfig): GridSpec {
  const [ax, , az] = rigTarget(config);
  const nx = Math.max(1, Math.round(config.roiWidth / config.cellSize)),
    ny = Math.max(1, Math.round(config.roiHeight / config.cellSize));
  return {
    nx,
    ny,
    cellSize: config.cellSize,
    x0: ax - (nx * config.cellSize) / 2,
    y0: az - (ny * config.cellSize) / 2,
  };
}
export const cellCenter = (grid: GridSpec, cell: number): [number, number] => [
  grid.x0 + ((cell % grid.nx) + 0.5) * grid.cellSize,
  grid.y0 + (Math.floor(cell / grid.nx) + 0.5) * grid.cellSize,
];
export function cellOf(grid: GridSpec, x: number, y: number): number {
  const ix = Math.floor((x - grid.x0) / grid.cellSize),
    iy = Math.floor((y - grid.y0) / grid.cellSize);
  return ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny
    ? -1
    : iy * grid.nx + ix;
}
