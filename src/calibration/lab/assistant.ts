import type { Point2 } from "../camera";
import {
  BOARD,
  LAB_CAMERA,
  LAB_PROJECTOR,
  boardTilt,
  cameraAt,
  defocusSigma,
  exposureGain,
  placementPose,
  truthProjections,
  type BoardPlacement,
  type CaptureSettings,
} from "./rig";

export type HintLevel = "error" | "warn" | "info";
export interface Hint {
  level: HintLevel;
  text: string;
}

const inside = (p: Point2 | null, w: number, h: number, m = 0) =>
  !!p && p[0] >= m && p[1] >= m && p[0] <= w - 1 - m && p[1] <= h - 1 - m;

/** Normal azimuth bucket (0–3) of a tilted board, or −1 when nearly frontal. */
export function tiltDirection(p: BoardPlacement): number {
  if (boardTilt(p) < 15) return -1;
  const n = placementPose(p).R.map((row) => row[2]);
  const a = Math.atan2(n[1], n[0]);
  return (
    Math.floor(((a + Math.PI + Math.PI / 4) % (2 * Math.PI)) / (Math.PI / 2)) %
    4
  );
}

/** Which of the 3×3 image cells contain at least one detected corner. */
export function coverage(cornerSets: Point2[][]): boolean[] {
  const cells = new Array(9).fill(false);
  for (const set of cornerSets)
    for (const [x, y] of set) {
      const i = Math.min(2, Math.floor((x / LAB_CAMERA.width) * 3)),
        j = Math.min(2, Math.floor((y / LAB_CAMERA.height) * 3));
      cells[j * 3 + i] = true;
    }
  return cells;
}
export const CELL_NAMES = [
  "左上",
  "上方",
  "右上",
  "左側",
  "中央",
  "右側",
  "左下",
  "下方",
  "右下",
];

/** The lab assistant: what would a person standing next to the bench point out? (uses the true geometry) */
export function hintsFor(
  placement: BoardPlacement,
  settings: CaptureSettings,
  previous: { placement: BoardPlacement; settings: CaptureSettings }[],
): Hint[] {
  const hints: Hint[] = [];
  const truth = truthProjections(placement, settings.focusMm);
  const prevFocus = previous[0]?.settings.focusMm;
  if (prevFocus !== undefined && settings.focusMm !== prevFocus) {
    const dfx = cameraAt(settings.focusMm).fx - cameraAt(prevFocus).fx;
    hints.push({
      level: "error",
      text: `對焦距離 ${settings.focusMm} mm 與已納入的照片（${prevFocus} mm）不同：轉對焦環會移動鏡片，焦距 fx 跟著變了約 ${dfx > 0 ? "+" : ""}${dfx.toFixed(1)} px。同一組校正混用不同對焦，K 只會是折衷值。請轉回 ${prevFocus} mm，或刪掉舊照片重拍。`,
    });
  }
  const outCam = truth.camera.filter(
    (p) => !inside(p, LAB_CAMERA.width, LAB_CAMERA.height, 8),
  ).length;
  const outProj = truth.projector.filter(
    (p) => !inside(p, LAB_PROJECTOR.width, LAB_PROJECTOR.height, 4),
  ).length;
  if (outCam)
    hints.push({
      level: "error",
      text: `有 ${outCam} 個角點不在相機畫面內：findChessboardCorners 需要看到全部 ${BOARD.cols}×${BOARD.rows} 個角點。`,
    });
  if (outProj)
    hints.push({
      level: "warn",
      text: `有 ${outProj} 個角點不在 Projector 照得到的範圍：這張無法用於 Projector 校正。`,
    });
  const tilt = boardTilt(placement);
  if (tilt < 10)
    hints.push({
      level: "info",
      text: `板子幾乎正對相機（${tilt.toFixed(0)}°）。正對的照片無法分開焦距與距離，記得也拍 20–45° 的傾斜姿態。`,
    });
  else if (tilt > 60)
    hints.push({
      level: "warn",
      text: `傾角 ${tilt.toFixed(0)}° 太大：格子被壓扁，角點容易偵測失敗或不準。`,
    });
  const pose = placementPose(placement);
  const z = pose.t[2] + pose.R[2][0] * 80 + pose.R[2][1] * 50;
  const sigma = Math.hypot(defocusSigma(settings, z), 0.5);
  if (sigma > 2)
    hints.push({
      level: "warn",
      text: `失焦：模糊 σ ≈ ${sigma.toFixed(1)} px（板子 ${z.toFixed(0)} mm、對焦 ${settings.focusMm} mm）。${previous.length ? "已經拍過照片就別再轉對焦環：把板子移近對焦距離，或縮小光圈（f 值調大）。" : "調整對焦（之後就鎖住），或縮小光圈（f 值調大）。"}`,
    });
  const peak = exposureGain(settings) * BOARD.white * (1 + settings.ambient);
  if (peak > 250)
    hints.push({
      level: "error",
      text: `白色格子會過曝（約 ${peak.toFixed(0)} DN）：條紋被削頂後相位會錯，請降低曝光或縮小光圈。`,
    });
  else if (peak < 90)
    hints.push({
      level: "warn",
      text: `影像偏暗（白格約 ${peak.toFixed(0)} DN）：雜訊相對變大。`,
    });
  const width =
    Math.max(...truth.camera.map((p) => (p ? p[0] : -Infinity))) -
    Math.min(...truth.camera.map((p) => (p ? p[0] : Infinity)));
  if (width < LAB_CAMERA.width * 0.3)
    hints.push({
      level: "info",
      text: "板子在畫面中很小（太遠）：角點只佔一小塊區域，對畸變的約束很弱。",
    });
  const similar = previous.findIndex(
    ({ placement: q }) =>
      Math.hypot(q.x - placement.x, q.y - placement.y, q.z - placement.z) <
        15 &&
      Math.abs(q.rx - placement.rx) +
        Math.abs(q.ry - placement.ry) +
        Math.abs(q.rz - placement.rz) <
        8,
  );
  if (similar >= 0)
    hints.push({
      level: "info",
      text: `跟第 ${similar + 1} 張幾乎一樣：重複的姿態不會提供新資訊。`,
    });
  return hints;
}
