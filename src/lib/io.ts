import {
  parseConfig,
  type SimulationConfig,
  type runSimulation,
} from "../core/simulation";
export const STORAGE_KEY = "structured-light-lab.parameters.v1";
export function serializeParameters(config: SimulationConfig): string {
  return JSON.stringify(
    { schemaVersion: 1, model: "three-step-1d", config },
    null,
    2,
  );
}
export function parseParameters(text: string): SimulationConfig {
  if (text.length > 1_048_576) throw new Error("參數檔超過 1 MB");
  const envelope: unknown = JSON.parse(text);
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("schemaVersion" in envelope) ||
    envelope.schemaVersion !== 1 ||
    !("model" in envelope) ||
    envelope.model !== "three-step-1d" ||
    !("config" in envelope)
  )
    throw new Error("不支援的參數格式或模型版本");
  return parseConfig(envelope.config);
}
export function saveParameters(
  storage: Pick<Storage, "setItem">,
  config: SimulationConfig,
): void {
  const validated = parseConfig(config);
  storage.setItem(STORAGE_KEY, serializeParameters(validated));
}
export function loadParameters(
  storage: Pick<Storage, "getItem">,
): SimulationConfig | null {
  const text = storage.getItem(STORAGE_KEY);
  return text === null ? null : parseParameters(text);
}
export function createCsv(
  config: SimulationConfig,
  result: ReturnType<typeof runSimulation>,
): string {
  const lines = [
    "# model=three-step-1d; units=rad; unwrap=relative-per-contiguous-row-segment",
    "# reference_phase_rad is synthetic evaluation-only truth; not a decoder input",
    "# config=" + JSON.stringify(config),
    "x,y,I1,I2,I3,estimated_mean,estimated_modulation,wrapped_rad,unwrapped_relative_rad,reference_phase_rad,valid,clipped",
  ];
  const finite = (value: number) =>
    Number.isFinite(value) ? String(value) : "";
  for (let i = 0; i < config.width * config.height; i++) {
    lines.push(
      [
        i % config.width,
        Math.floor(i / config.width),
        ...result.captures.frames.map((frame) => finite(frame[i])),
        finite(result.phase.mean[i]),
        finite(result.phase.modulation[i]),
        finite(result.phase.wrapped[i]),
        finite(result.unwrapped[i]),
        finite(result.captures.referencePhase[i]),
        result.phase.valid[i],
        result.captures.clipped[i],
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
