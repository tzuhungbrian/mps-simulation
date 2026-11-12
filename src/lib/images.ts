import type { runSimulation, SimulationConfig } from "../core/simulation";

/** Display-only RGB mapping. Numerical estimates always remain Float64 radians. */
export function phaseRgb(phase: number): [number, number, number] {
  if (!Number.isFinite(phase)) return [31, 36, 47];
  const t = phase + Math.PI;
  return [
    Math.round(128 + 110 * Math.cos(t - 2.1)),
    Math.round(128 + 110 * Math.cos(t)),
    Math.round(128 + 110 * Math.cos(t + 2.1)),
  ];
}
export function rasterize(
  values: ArrayLike<number>,
  width: number,
  height: number,
  kind: "intensity" | "phase" | "valid",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 不可用");
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const value = values[i];
    const c =
      kind === "phase"
        ? phaseRgb(value)
        : kind === "valid"
          ? value
            ? [94, 228, 189]
            : [66, 42, 60]
          : [value * 255, value * 255, value * 255];
    image.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function exportPng(
  config: SimulationConfig,
  result: ReturnType<typeof runSimulation>,
  probeX: number,
  probeY: number,
): Promise<void> {
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 1120;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 不可用");
  ctx.fillStyle = "#0c1017";
  ctx.fillRect(0, 0, c.width, c.height);
  const text = (
    s: string,
    x: number,
    y: number,
    size = 19,
    color = "#a1afc0",
  ) => {
    ctx.fillStyle = color;
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.fillText(s, x, y);
  };
  text("STRUCTURED LIGHT LAB / 三步 Phase Shifting", 48, 58, 28, "#e5ecf5");
  text("MVP 1 · Synthetic linear response · No 3D reconstruction", 48, 92);
  text(
    `f=${config.frequency} cycles/width   φ₀=${config.phaseOffset.toFixed(4)} rad   A=${config.mean}   B=${config.amplitude}   σ=${config.noiseSigma}   seed=${config.seed}`,
    48,
    126,
  );
  const margin = 48,
    gap = 24,
    tileW = (1600 - 2 * margin - 2 * gap) / 3,
    tileH = 170;
  result.captures.frames.forEach((frame, k) => {
    const x = margin + k * (tileW + gap);
    text(`I${k + 1} · δ=${k * 120}°`, x, 176, 20, "#e5ecf5");
    ctx.drawImage(
      rasterize(frame, config.width, config.height, "intensity"),
      x,
      194,
      tileW,
      tileH,
    );
  });
  text("Wrapped Phase [−π, π)", 48, 414, 22, "#e5ecf5");
  ctx.drawImage(
    rasterize(result.phase.wrapped, config.width, config.height, "phase"),
    48,
    434,
    1000,
    210,
  );
  text("Validity mask", 1080, 414, 22, "#e5ecf5");
  ctx.drawImage(
    rasterize(result.phase.valid, config.width, config.height, "valid"),
    1080,
    434,
    472,
    210,
  );
  const rowOffset = probeY * config.width,
    chartX = 70,
    chartY = 710,
    chartW = 1460,
    chartH = 230;
  text(
    `Relative 1D Unwrapped Phase · row y=${probeY} · segment-local anchor`,
    48,
    690,
    20,
    "#e5ecf5",
  );
  const row = result.unwrapped.subarray(rowOffset, rowOffset + config.width);
  let low = Infinity,
    high = -Infinity;
  for (const v of row) {
    if (Number.isFinite(v)) {
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
  }
  if (!Number.isFinite(low)) {
    low = 0;
    high = 1;
  }
  high = Math.max(high, low + 1);
  ctx.strokeStyle = "#28313e";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = chartY + (i / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(chartX, y);
    ctx.lineTo(chartX + chartW, y);
    ctx.stroke();
    text((high - (i / 4) * (high - low)).toFixed(1), 10, y + 5, 14);
  }
  ctx.strokeStyle = "#5ee4bd";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let connected = false;
  row.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      connected = false;
      return;
    }
    const x = chartX + (i / (config.width - 1)) * chartW,
      y = chartY + (1 - (v - low) / (high - low)) * chartH;
    if (connected) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    connected = true;
  });
  ctx.stroke();
  text(
    `Probe x=${probeX}, y=${probeY}  |  Circular RMSE=${result.metrics.rmse === null ? "N/A" : result.metrics.rmse.toExponential(6)} rad  |  Valid=${(result.metrics.validRatio * 100).toFixed(3)}%`,
    48,
    992,
    20,
    "#e5ecf5",
  );
  text(
    "Unwrap uses captures only. Unknown integer order remains per contiguous segment; no absolute phase or depth.",
    48,
    1030,
    17,
  );
  text(
    "Gaussian noise + [0,1] hard clipping only. No geometry, calibration, occlusion, defocus or interreflection.",
    48,
    1060,
    17,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG 編碼失敗"))),
      "image/png",
    ),
  );
  downloadBlob(blob, "structured-light-mvp1.png");
}
