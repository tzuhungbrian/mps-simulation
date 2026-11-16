import { useEffect, useMemo, useRef } from "react";
import type { Point2 } from "../camera";

/** 8-bit grayscale image with optional point overlays (image pixel coordinates). */
export function GrayImage({
  data,
  width,
  height,
  overlay,
  label,
}: {
  data: Uint8Array;
  width: number;
  height: number;
  overlay?: React.ReactNode;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [data, width, height]);
  return (
    <div className="lab-image" role="img" aria-label={label}>
      <canvas ref={canvas} />
      {overlay && (
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {overlay}
        </svg>
      )}
    </div>
  );
}

/** Float map shown with a hue colormap over [0, range]; NaN = black. */
export function PhaseMap({
  data,
  width,
  height,
  range,
  label,
  overlay,
}: {
  data: Float32Array;
  width: number;
  height: number;
  range: number;
  label: string;
  overlay?: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (Number.isNaN(v)) {
        img.data[4 * i + 3] = 255;
        continue;
      }
      const t = Math.max(0, Math.min(1, v / range));
      // Cheap perceptual-ish ramp: blue → cyan → yellow → red.
      img.data[4 * i] = 255 * Math.min(1, Math.max(0, 1.6 * t - 0.4));
      img.data[4 * i + 1] =
        255 * Math.min(1, Math.max(0, 1.8 * (0.5 - Math.abs(t - 0.5)) + 0.1));
      img.data[4 * i + 2] = 255 * Math.min(1, Math.max(0, 1 - 1.6 * t));
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [data, width, height, range]);
  return (
    <div className="lab-image" role="img" aria-label={label}>
      <canvas ref={canvas} />
      {overlay && (
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {overlay}
        </svg>
      )}
    </div>
  );
}

export function CornerMarks({
  points,
  color = "#5ee4bd",
  r = 5,
}: {
  points: (Point2 | null)[];
  color?: string;
  r?: number;
}) {
  return (
    <g>
      {points.map((p, i) =>
        p ? (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={i === 0 ? r * 1.8 : r}
            fill="none"
            stroke={i === 0 ? "#ff6b6b" : color}
            strokeWidth={r / 2.5}
          />
        ) : null,
      )}
    </g>
  );
}

export function ErrorVectors({
  from,
  to,
  gain,
}: {
  from: Point2[];
  to: Point2[];
  gain: number;
}) {
  const lines = useMemo(
    () =>
      from.map((p, i) => [
        p[0],
        p[1],
        p[0] + (to[i][0] - p[0]) * gain,
        p[1] + (to[i][1] - p[1]) * gain,
      ]),
    [from, to, gain],
  );
  return (
    <g stroke="#ff9b85" strokeWidth={2.5}>
      {lines.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
    </g>
  );
}
