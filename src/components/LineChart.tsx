import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

export interface Series {
  values: ArrayLike<number>;
  color: string;
  label: string;
  dashed?: boolean;
}
interface Props {
  series: Series[];
  min: number;
  max: number;
  selected?: number;
  onSelect?: (fraction: number) => void;
  xLabels?: string[];
  yLabels?: string[];
  testId?: string;
  compact?: boolean;
  markers?: { x: number; y: number; color: string }[];
}
export default function LineChart({
  series,
  min,
  max,
  selected,
  onSelect,
  xLabels = ["0", "0.25", "0.50", "0.75", "1.00"],
  yLabels,
  testId,
  compact,
  markers,
}: Props) {
  const id = useId().replaceAll(":", "");
  const svg = useRef<SVGSVGElement>(null),
    [measuredWidth, setMeasuredWidth] = useState(800);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setMeasuredWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const W = measuredWidth,
    H = compact ? 210 : 260,
    L = 68,
    R = 20,
    T = 20,
    B = 36;
  const plotW = W - L - R,
    plotH = H - T - B;
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * plotH;
  function select(e: PointerEvent<SVGSVGElement>) {
    if (!onSelect) return;
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    onSelect(Math.max(0, Math.min(1, (point.x - L) / plotW)));
  }
  return (
    <svg
      ref={svg}
      data-testid={testId}
      className={`line-chart ${onSelect ? "interactive" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      role={onSelect ? "slider" : "img"}
      aria-label={onSelect ? "一維曲線探針位置" : "量測曲線"}
      aria-valuemin={onSelect ? 0 : undefined}
      aria-valuemax={onSelect ? 100 : undefined}
      aria-valuenow={onSelect ? Math.round((selected ?? 0) * 100) : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (onSelect && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          onSelect(
            Math.max(
              0,
              Math.min(
                1,
                (selected ?? 0) +
                  (e.key === "ArrowRight" ? 1 : -1) /
                    Math.max(1, series[0].values.length - 1),
              ),
            ),
          );
        }
      }}
      onPointerDown={(e) => {
        if (onSelect) {
          e.currentTarget.setPointerCapture(e.pointerId);
          select(e);
        }
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) select(e);
      }}
    >
      <defs>
        <clipPath id={id}>
          <rect x={L} y={T} width={plotW} height={plotH} />
        </clipPath>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={L}
            y1={T + t * plotH}
            x2={W - R}
            y2={T + t * plotH}
            className="chart-grid"
          />
          <text
            x={L - 12}
            y={T + t * plotH + 4}
            textAnchor="end"
            className="chart-tick"
          >
            {yLabels?.[Math.round(t * 4)] ?? (max - (max - min) * t).toFixed(2)}
          </text>
        </g>
      ))}
      {xLabels.map((label, i) => (
        <g key={i}>
          <line
            x1={L + (i / (xLabels.length - 1)) * plotW}
            y1={T}
            x2={L + (i / (xLabels.length - 1)) * plotW}
            y2={H - B}
            className="chart-grid vertical"
          />
          <text
            x={L + (i / (xLabels.length - 1)) * plotW}
            y={H - 8}
            textAnchor="middle"
            className="chart-tick"
          >
            {label}
          </text>
        </g>
      ))}
      <g clipPath={`url(#${id})`}>
        {series.map((s) => {
          let d = "",
            previous = NaN;
          for (let i = 0; i < s.values.length; i++) {
            const v = s.values[i];
            if (Number.isFinite(v)) {
              const gap =
                !Number.isFinite(previous) ||
                (s.label.includes("Wrapped") &&
                  Math.abs(v - previous) > Math.PI);
              d += `${gap ? "M" : "L"}${(L + (i / Math.max(1, s.values.length - 1)) * plotW).toFixed(2)},${y(v).toFixed(2)} `;
            }
            previous = v;
          }
          return (
            <path
              key={s.label}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? "5 5" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {selected !== undefined && (
          <>
            <rect
              x={L + selected * plotW - 9}
              y={T}
              width={18}
              height={plotH}
              fill="rgba(255,255,255,.035)"
            />
            <line
              x1={L + selected * plotW}
              y1={T}
              x2={L + selected * plotW}
              y2={H - B}
              stroke="#c4d1de"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            {series.map((s) => {
              const value =
                s.values[Math.round(selected * (s.values.length - 1))];
              return Number.isFinite(value) ? (
                <circle
                  key={s.label}
                  cx={L + selected * plotW}
                  cy={y(value)}
                  r={4}
                  fill={s.color}
                  stroke="#121820"
                  strokeWidth={2}
                />
              ) : null;
            })}
          </>
        )}
        {markers?.map((m, i) => (
          <circle
            key={i}
            cx={L + m.x * plotW}
            cy={y(m.y)}
            r={5}
            stroke="#0c1017"
            strokeWidth={2}
            fill={m.color}
          />
        ))}
      </g>
    </svg>
  );
}
