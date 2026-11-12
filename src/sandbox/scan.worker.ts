import { runWorldScan, type WorldConfig, type WorldScan } from "./scanner";

export type ScanRequest = { config: WorldConfig };
export type ScanResponse =
  | { type: "progress"; fraction: number }
  | { type: "done"; scan: WorldScan }
  | { type: "error"; message: string };

// tsconfig uses the DOM lib, so describe the worker scope's two members locally.
const scope = self as unknown as {
  postMessage: (message: ScanResponse) => void;
  onmessage: ((event: MessageEvent<ScanRequest>) => void) | null;
};
const post = (message: ScanResponse) => scope.postMessage(message);

scope.onmessage = (event) => {
  try {
    let reported = 0;
    const scan = runWorldScan(
      event.data.config,
      undefined,
      undefined,
      (fraction) => {
        if (fraction - reported >= 0.02 || fraction === 1) {
          reported = fraction;
          post({ type: "progress", fraction });
        }
      },
    );
    post({ type: "done", scan });
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
