import type { WorldConfig } from "../sandbox/scanner";
import {
  runAoi,
  runSweep,
  type AoiRun,
  type FusionOptions,
  type SweepRow,
  type SweepVariable,
} from "./simulate";

export type AoiRequest =
  | { type: "run"; config: WorldConfig; pairIds: string[] | null }
  | {
      type: "sweep";
      config: WorldConfig;
      pairIds: string[] | null;
      variable: SweepVariable;
      values: number[];
      options: FusionOptions;
    };
export type AoiResponse =
  | { type: "progress"; fraction: number; label: string }
  | { type: "run"; run: AoiRun }
  | { type: "sweep"; rows: SweepRow[] }
  | { type: "error"; message: string };

const scope = self as unknown as {
  postMessage: (message: AoiResponse) => void;
  onmessage: ((event: MessageEvent<AoiRequest>) => void) | null;
};
const post = (message: AoiResponse) => scope.postMessage(message);

scope.onmessage = (event) => {
  let reported = -1;
  const progress = (fraction: number, label: string) => {
    if (fraction - reported >= 0.01 || fraction === 1) {
      reported = fraction;
      post({ type: "progress", fraction, label });
    }
  };
  try {
    const request = event.data;
    if (request.type === "run")
      post({
        type: "run",
        run: runAoi(request.config, request.pairIds, progress),
      });
    else
      post({
        type: "sweep",
        rows: runSweep(
          request.config,
          request.pairIds,
          request.variable,
          request.values,
          request.options,
          progress,
        ),
      });
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
