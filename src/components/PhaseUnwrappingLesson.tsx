import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { TAU, wrapPhase } from "../core/simulation";
import {
  buildUnwrapLesson,
  describeUnwrapTransition,
} from "../lib/unwrappingLesson";
import LineChart, { type Series } from "./LineChart";
import "./PhaseUnwrappingLesson.css";

interface Props {
  wrapped: Float64Array;
  valid: Uint8Array;
  row: number;
  width: number;
  probeX: number;
  onSelectX: (fraction: number) => void;
}
const PURPLE = "#b7a0fa",
  GREEN = "#5ee4bd";
const rad = (value: number | null) =>
  value !== null && Number.isFinite(value) ? value.toFixed(3) : "—";
const finite = (value: number) => (Number.isFinite(value) ? value : undefined);

export default function PhaseUnwrappingLesson({
  wrapped,
  valid,
  row,
  width,
  probeX,
  onSelectX,
}: Props) {
  const [showUnwrapped, setShowUnwrapped] = useState(true);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [showGap, setShowGap] = useState(false);
  const [answer, setAnswer] = useState<{
    index: number;
    rawDelta: number;
    periods: number;
  } | null>(null);
  const initialized = useRef(false);
  const data = useMemo(
    () =>
      buildUnwrapLesson(
        wrapped.subarray(row, row + width),
        valid.subarray(row, row + width),
        { periodOffset, showGap },
      ),
    [wrapped, valid, row, width, periodOffset, showGap],
  );
  const transition = describeUnwrapTransition(data, probeX);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (data.boundaries.length) onSelectX(data.boundaries[0] / (width - 1));
  }, [data.boundaries, width, onSelectX]);
  const choice =
    answer?.index === probeX && answer.rawDelta === transition.rawDelta
      ? answer.periods
      : null;
  const series: Series[] = [
    { values: data.wrapped, color: PURPLE, label: "Wrapped Phase" },
  ];
  if (showUnwrapped)
    series.push({
      values: data.displayed,
      color: GREEN,
      label: "Relative Unwrapped Phase",
    });
  let min = -Math.PI,
    max = Math.PI;
  if (showUnwrapped)
    for (const v of data.displayed) {
      if (Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  const selected = probeX / (width - 1);
  const nextBoundary =
    data.boundaries.find((i) => i > probeX) ?? data.boundaries[0];
  const candidate = data.displayed[probeX];
  const rewrapped = Number.isFinite(candidate) ? wrapPhase(candidate) : NaN;
  const correction =
    transition.periodAdjustment === 1
      ? "加 2π"
      : transition.periodAdjustment === -1
        ? "減 2π"
        : "不加不減";
  return (
    <div className="unwrap-lesson">
      <section
        className="lesson-panel unwrap-panel"
        aria-label="逐點解開相位跳變"
      >
        <div className="lesson-plot-heading">
          <h2>1. 在跳變處，親手補回一圈</h2>
          <span>2π rad = 360°</span>
        </div>
        <p>
          白線選中目前像素 x；兩點都有效時，藍點標出左鄰居 x − 1。
          先假設兩點的真實相位相差不到半圈（π），再比較量測角度，找最短的角度差。
        </p>
        <div className="unwrap-workbench" data-testid="unwrap-workbench">
          <div className="unwrap-plot">
            <div className="lesson-chart-legend">
              <span style={{ color: PURPLE }}>
                紫色：量測得到的 Wrapped Phase
              </span>
              {showUnwrapped && (
                <span style={{ color: GREEN }}>
                  綠色：Relative Unwrapped Phase（k = {periodOffset}）
                </span>
              )}
            </div>
            <p className="lesson-axis-description">
              縱軸＝相位（rad） · 橫軸＝影像像素 x · 點擊、拖曳或用方向鍵選像素
            </p>
            <LineChart
              series={series}
              min={min - 0.2}
              max={max + 0.2}
              selected={selected}
              onSelect={onSelectX}
              xLabels={[0, 0.25, 0.5, 0.75, 1].map((t) =>
                String(Math.round(t * (width - 1))),
              )}
              markers={
                transition.kind === "connected"
                  ? [
                      {
                        x: (probeX - 1) / (width - 1),
                        y: data.wrapped[probeX - 1],
                        color: "#69d9ff",
                      },
                    ]
                  : []
              }
              testId="guide-unwrap-chart"
              annotations={
                Number.isFinite(data.wrapped[probeX])
                  ? showUnwrapped &&
                    Math.abs(candidate - data.wrapped[probeX]) < 1e-10
                    ? [
                        {
                          id: "phase-combined-label",
                          x: selected,
                          y: candidate,
                          text: `φ=Φ=${rad(candidate)}`,
                          color: GREEN,
                        },
                      ]
                    : [
                        {
                          id: "phase-wrapped-label",
                          x: selected,
                          y: data.wrapped[probeX],
                          text: `φ=${rad(data.wrapped[probeX])}`,
                          color: PURPLE,
                        },
                        ...(showUnwrapped && Number.isFinite(candidate)
                          ? [
                              {
                                id: "phase-unwrapped-label",
                                x: selected,
                                y: candidate,
                                text: `Φ=${rad(candidate)}`,
                                color: GREEN,
                              },
                            ]
                          : []),
                      ]
                  : []
              }
            />
            <div className="unwrap-controls">
              <button
                className="lesson-secondary"
                disabled={nextBoundary === undefined}
                onClick={() =>
                  nextBoundary !== undefined &&
                  onSelectX(nextBoundary / (width - 1))
                }
              >
                找下一個跳變
                <ArrowRight size={18} />
              </button>
              <div
                className="unwrap-pixel-controls"
                role="group"
                aria-label="逐點選擇像素"
              >
                <button
                  className="lesson-secondary"
                  aria-label="前一個像素"
                  disabled={probeX === 0}
                  onClick={() => onSelectX((probeX - 1) / (width - 1))}
                >
                  <ArrowLeft size={17} />
                </button>
                <span data-testid="unwrap-pixel-index">x = {probeX}</span>
                <button
                  className="lesson-secondary"
                  aria-label="下一個像素"
                  disabled={probeX === width - 1}
                  onClick={() => onSelectX((probeX + 1) / (width - 1))}
                >
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          </div>
          <div className="unwrap-inspector" aria-label="所選像素的數值與公式">
            <div className="unwrap-numbers">
              <div>
                <span>左鄰居 φ(x − 1)</span>
                <b>
                  {rad(
                    transition.kind === "connected"
                      ? data.wrapped[probeX - 1]
                      : null,
                  )}{" "}
                  <small>rad</small>
                </b>
              </div>
              <div>
                <span>目前像素 φ(x)</span>
                <b style={{ color: PURPLE }}>
                  <span
                    data-testid="unwrap-live-wrapped"
                    data-value={finite(data.wrapped[probeX])}
                  >
                    {rad(data.wrapped[probeX])}
                  </span>{" "}
                  <small>rad</small>
                </b>
              </div>
              <div>
                <span>直接相減 d = 右 − 左</span>
                <b
                  data-testid="unwrap-raw-delta"
                  data-value={transition.rawDelta ?? undefined}
                >
                  {rad(transition.rawDelta)} <small>rad</small>
                </b>
              </div>
              <div className="unwrap-corrected">
                <span>最短相位差 d′</span>
                <b
                  data-testid="unwrap-corrected-delta"
                  data-value={transition.correctedDelta ?? undefined}
                >
                  {rad(transition.correctedDelta)} <small>rad</small>
                </b>
              </div>
            </div>
            <div
              className="unwrap-equation"
              data-testid="unwrap-live-formula"
              data-previous={transition.previousUnwrapped ?? undefined}
              data-delta={transition.correctedDelta ?? undefined}
              data-value={finite(candidate)}
            >
              <span>Φ(x) = Φ(x − 1) + d′</span>
              {transition.kind === "connected" ? (
                <p>
                  {rad(transition.previousUnwrapped)} +{" "}
                  {rad(transition.correctedDelta)} ={" "}
                  <strong
                    data-testid="unwrap-live-relative"
                    style={{ color: GREEN }}
                  >
                    {rad(candidate)}
                  </strong>{" "}
                  rad
                </p>
              ) : (
                <p>
                  {transition.kind === "anchor"
                    ? "新區段的相對起點"
                    : "無效像素，不補值"}
                  ：
                  <strong
                    data-testid="unwrap-live-relative"
                    style={{ color: GREEN }}
                  >
                    {rad(candidate)}
                  </strong>{" "}
                  rad
                </p>
              )}
            </div>
          </div>
        </div>
        {transition.kind === "connected" && !transition.ambiguous ? (
          <>
            <p
              className="unwrap-transition"
              data-testid="unwrap-transition-note"
            >
              {transition.periodAdjustment === 0
                ? "這兩點沒有跨過 ±π 邊界，直接用原始差值。"
                : "直接相減看起來跳了將近一整圈；若表面足夠連續，應選擇較小的那個相位差。"}
            </p>
            <div className="unwrap-quiz">
              <strong>現在試算：你會怎麼修正這個差值？</strong>
              <div
                className="unwrap-controls"
                role="group"
                aria-label="選擇跨界修正"
              >
                {[
                  { periods: 1, label: "加 2π" },
                  { periods: 0, label: "不加不減" },
                  { periods: -1, label: "減 2π" },
                ].map(({ periods, label }) => (
                  <button
                    className="lesson-secondary"
                    key={periods}
                    aria-pressed={choice === periods}
                    onClick={() =>
                      setAnswer({
                        index: probeX,
                        rawDelta: transition.rawDelta!,
                        periods,
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {choice !== null && (
                <p
                  role="status"
                  data-testid="unwrap-feedback"
                  className={
                    choice === transition.periodAdjustment
                      ? "unwrap-feedback correct"
                      : "unwrap-feedback"
                  }
                >
                  {choice === transition.periodAdjustment
                    ? "在連續性假設下，這樣接："
                    : "還不符合最短相位差。你選的結果是："}{" "}
                  {rad(transition.rawDelta! + choice * TAU)} rad。
                  {choice !== transition.periodAdjustment &&
                    ` 試試「${correction}」，讓差值落在 −π 到 +π 之間。`}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="unwrap-transition" data-testid="unwrap-transition-note">
            {transition.kind === "invalid"
              ? "此像素無效：保持 N/A，不補值，也不跨過缺口串接。"
              : transition.kind === "anchor"
                ? "這是新區段起點：暫把這個 Wrapped Phase 當相對錨點，不借用前一區段的整數週期。"
                : "相位差在數值容差內接近 π；兩個方向幾乎同樣短，本教學不把這個方向判定當作可靠答案。"}
          </p>
        )}
        <button
          className="lesson-primary"
          aria-pressed={showUnwrapped}
          onClick={() => setShowUnwrapped((v) => !v)}
        >
          {showUnwrapped ? "只看 Wrapped Phase" : "套用 Spatial Unwrap"}
        </button>
        <p className="lesson-caption">
          綠線使用實際的 <code>unwrapRows</code>：逐點累積最短相位差。不讀取
          Ground Truth，也不對量測值做平滑。
        </p>
        <details className="lesson-formula">
          <summary>公式如何寫？展開逐點遞推式</summary>
          <code>
            d = φ(x) − φ(x − 1)
            <br />
            d′ = wrap(d) ∈ [−π, π)
            <br />
            Φ(x) = Φ(x − 1) + d′
          </code>
          <p>
            d 小於 −π 時加 2π；大於 +π 時減 2π；介於兩者之間則不改。恰好 π
            時方向有歧義，程式雖有區間慣例，仍不能據此判定真實方向。
          </p>
          <p>
            每個有效區段從 Φ(x₀) = φ(x₀) 開始，相當於暫選起點 k =
            0；這不是測出了真實的絕對條紋序號。
          </p>
        </details>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label="相對相位的整數週期歧義"
      >
        <div className="lesson-instruction">
          <strong>先把「角度歸零」和「表面跳變」分開</strong>
          <p className="unwrap-intro">
            Wrapped Phase 只保留一圈內的角度，範圍是 −π 到 +π（不含 +π）。走過
            +π，就從 −π 繼續；像時鐘轉了一圈，讀數會重複。
            <strong>
              Phase Unwrapping 要補回漏掉的整圈 2π，而不是把曲線平滑掉。
            </strong>
          </p>
        </div>
        <div className="lesson-plot-heading">
          <h2>2. 接得連續，仍然不知道第幾圈</h2>
        </div>
        <p>
          把整條連續曲線加上或減去 2π，重新 Wrapped
          之後仍得到同樣的角度。所以上面的連續性假設，可以找回區段內相對跨了幾圈，卻不能決定起點的那一圈。
        </p>
        <div
          className="unwrap-controls"
          role="group"
          aria-label="假設未知的整數週期偏移"
        >
          {[-1, 0, 1].map((k) => (
            <button
              key={k}
              className="lesson-secondary"
              aria-pressed={periodOffset === k}
              onClick={() => {
                setPeriodOffset(k);
                setShowUnwrapped(true);
              }}
            >
              假設 k = {k > 0 ? "+" : ""}
              {k}
            </button>
          ))}
        </div>
        <div className="unwrap-equivalence">
          <div>
            <span>候選 Φ + 2πk</span>
            <b
              data-testid="unwrap-candidate-value"
              data-value={finite(candidate)}
            >
              {rad(candidate)}
            </b>
            <small>rad · 一種可能的展開結果</small>
          </div>
          <div>
            <span>再 Wrapped 一次</span>
            <b
              data-testid="unwrap-rewrapped-value"
              data-value={finite(rewrapped)}
            >
              {rad(rewrapped)}
            </b>
            <small>rad · 回到一圈內</small>
          </div>
          <div>
            <span>原本量測的 Wrapped</span>
            <b
              data-testid="unwrap-wrapped-value"
              data-value={finite(data.wrapped[probeX])}
            >
              {rad(data.wrapped[probeX])}
            </b>
            <small>rad · 不因 k 而改變</small>
          </div>
        </div>
        <p className="unwrap-warning" data-testid="unwrap-absolute-warning">
          <strong>這仍是 Relative Phase，不是深度。</strong> 單一頻率的 Spatial
          Unwrap
          無法決定絕對條紋序號，需要額外的編碼、參考錨點或其他約束。每個不連通區段還各有獨立的未知整數偏移；這裡的
          k 按鈕只示範所有區段一起平移的其中一族候選。
        </p>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label="Unwrap 的假設與失敗情況"
      >
        <div className="lesson-plot-heading">
          <h2>3. 這種接法，什麼時候不能相信？</h2>
        </div>
        <p>
          <strong>相鄰真實相位差的絕對值必須小於 π。</strong>{" "}
          如果有深度斷層、條紋太密而取樣不足，或雜訊把差值推過邊界，最短路徑可能接錯一整圈。曲線看起來連續，不代表接對；單靠
          Wrapped Phase 也無法驗證這個假設。
        </p>
        <label className="unwrap-gap-toggle">
          <input
            type="checkbox"
            checked={showGap}
            onChange={(e) => {
              setShowGap(e.target.checked);
              setShowUnwrapped(true);
            }}
          />
          加入無效區段（教學遮罩）
        </label>
        <p className="unwrap-segments" data-testid="unwrap-segment-count">
          {data.segmentCount} 個獨立連續區段
        </p>
        {data.gap && (
          <>
            <p data-testid="unwrap-gap-note">
              將 x = {data.gap.start}…{data.gap.end - 1}{" "}
              標成無效，觀察上方綠線斷開。這只是教學遮罩，不是遮擋物理模擬，不會改寫三張曝光或原始
              Valid Pixel Ratio。
            </p>
            <button
              className="lesson-secondary"
              onClick={() => onSelectX(data.gap!.end / (width - 1))}
            >
              看無效區段後的起點
              <ArrowRight size={18} />
            </button>
          </>
        )}
        <p>
          無效像素不能硬接；缺口後必須重新起算。實際研究中，還需要可靠度檢查、適合的編碼與量測驗證。
        </p>
      </section>

      <div className="lesson-takeaway">
        <strong>最後分清楚兩種 Unwrapping</strong>
        <p>
          <b>Spatial Unwrapping</b>{" "}
          借用「旁邊的像素」，靠空間連續性接相位；本頁實際計算的是這種 1D 方法。
        </p>
        <p>
          <b>Temporal Unwrapping</b>{" "}
          則對「同一個像素」再拍不同頻率的條紋。先用測量範圍內無歧義的低頻定位，再判斷高頻屬於哪一圈；它需要額外曝光，不是把單頻曲線接順就完成。
        </p>
        <p>
          知道絕對對應後，還要用 Camera–Projector Calibration 與 Triangulation
          才能得到 3D。本頁沒有計算深度；3D
          示意只保留候選光平面，不用真值替你選答案。
        </p>
      </div>
    </div>
  );
}
