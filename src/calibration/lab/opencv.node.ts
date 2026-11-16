import type { CV } from "./opencv";

/** Node-side OpenCV for tests (the browser path uses loadOpenCV). */
export async function opencvForTests(): Promise<CV> {
  // No @types/node in this project; reach Node's module API without a typed import.
  const nodeProcess = (
    globalThis as unknown as {
      process: {
        getBuiltinModule: (id: string) => {
          createRequire: (url: string) => (id: string) => unknown;
        };
      };
    }
  ).process;
  const require = nodeProcess
    .getBuiltinModule("module")
    .createRequire(import.meta.url);
  const cv = (await require("@techstark/opencv-js")) as CV;
  if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = r));
  return cv;
}
