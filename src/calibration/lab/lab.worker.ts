import {
  stereoCalibrate,
  type Intrinsics,
  type Point2,
  type StereoResult,
} from "../camera";
import { runCapture, type Capture } from "./capture";
import {
  calibrateCameraCV,
  loadOpenCV,
  projectPointsCV,
  type CalibFlag,
  type CvCalibration,
} from "./opencv";
import {
  boardCorners,
  LAB_CAMERA,
  LAB_PROJECTOR,
  type BoardPlacement,
  type CaptureSettings,
} from "./rig";

export type LabRequest =
  | { id: number; type: "load" }
  | {
      id: number;
      type: "capture";
      placement: BoardPlacement;
      settings: CaptureSettings;
      seed: number;
    }
  | {
      id: number;
      type: "calibrate-camera";
      views: Point2[][];
      flags: CalibFlag[];
    }
  | {
      id: number;
      type: "calibrate-projector";
      camera: Intrinsics;
      cameraViews: Point2[][];
      projectorViews: Point2[][];
      flags: CalibFlag[];
    };

export interface CameraCalibrationResult extends CvCalibration {
  /** cv.projectPoints of the board with the estimated parameters, per view. */
  reprojected: Point2[][];
}
export interface ProjectorCalibrationResult {
  projector: CameraCalibrationResult;
  stereo: StereoResult;
}

export type LabResponse =
  | { id: number; ok: true; type: "load" }
  | { id: number; ok: true; type: "capture"; capture: Capture }
  | {
      id: number;
      ok: true;
      type: "calibrate-camera";
      result: CameraCalibrationResult;
    }
  | {
      id: number;
      ok: true;
      type: "calibrate-projector";
      result: ProjectorCalibrationResult;
    }
  | { id: number; ok: false; error: string };

const scope = self as unknown as {
  postMessage: (message: LabResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<LabRequest>) => void) | null;
};

function calibrate(
  views: Point2[][],
  K: Intrinsics,
  flags: CalibFlag[],
  cv: unknown,
): CameraCalibrationResult {
  const obj = boardCorners();
  const result = calibrateCameraCV(cv, obj, views, K.width, K.height, flags);
  return {
    ...result,
    reprojected: result.poses.map((pose) =>
      projectPointsCV(cv, obj, pose, result.K),
    ),
  };
}

scope.onmessage = async (event) => {
  const req = event.data;
  try {
    const cv = await loadOpenCV();
    if (req.type === "load")
      scope.postMessage({ id: req.id, ok: true, type: "load" });
    else if (req.type === "capture") {
      const capture = runCapture(req.placement, req.settings, req.seed, cv);
      const transfer: Transferable[] = [capture.image.buffer as ArrayBuffer];
      if (capture.fringe) transfer.push(capture.fringe.buffer as ArrayBuffer);
      scope.postMessage(
        { id: req.id, ok: true, type: "capture", capture },
        transfer,
      );
    } else if (req.type === "calibrate-camera") {
      scope.postMessage({
        id: req.id,
        ok: true,
        type: "calibrate-camera",
        result: calibrate(req.views, LAB_CAMERA, req.flags, cv),
      });
    } else {
      const projector = calibrate(
        req.projectorViews,
        LAB_PROJECTOR,
        req.flags,
        cv,
      );
      const stereo = stereoCalibrate(
        boardCorners(),
        req.cameraViews,
        req.projectorViews,
        req.camera,
        projector.K,
      );
      scope.postMessage({
        id: req.id,
        ok: true,
        type: "calibrate-projector",
        result: { projector, stereo },
      });
    }
  } catch (e) {
    scope.postMessage({
      id: req.id,
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : typeof e === "number"
            ? `OpenCV 例外（代碼 ${e}）`
            : String(e),
    });
  }
};
