import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { TAU, wrapPhase } from "../core/simulation";
import { t } from "../i18n";
import {
  buildUnwrapLesson,
  describeUnwrapTransition,
} from "../lib/unwrappingLesson";
import {
  FINE,
  MAX_STEP_CYCLES,
  spatialAligned,
  stepColumn,
  synthesizeScene,
} from "../lib/temporalLesson";
import LineChart, { type Series } from "./LineChart";
import "./PhaseUnwrappingLesson.css";

interface Props {
  wrapped: Float64Array;
  valid: Uint8Array;
  row: number;
  width: number;
  probeX: number;
  onSelectX: (fraction: number) => void;
  stepCycles: number;
  onStepCycles: (cycles: number) => void;
}
const PURPLE = "#b7a0fa",
  GREEN = "#5ee4bd",
  TRUTH = "#93a4b8";
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
  stepCycles,
  onStepCycles,
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
      ? t("加 2π", "Add 2π")
      : transition.periodAdjustment === -1
        ? t("減 2π", "Subtract 2π")
        : t("不加不減", "Leave it as is");
  const stepScene = useMemo(
    () => synthesizeScene({ width, stepCycles }),
    [width, stepCycles],
  );
  const stepSpatial = useMemo(() => spatialAligned(stepScene), [stepScene]);
  const stepTruth = useMemo(
    () => stepScene.truth!.map((u) => TAU * FINE * u),
    [stepScene],
  );
  const x0 = stepColumn(width);
  const localJump = stepTruth[x0] - stepTruth[x0 - 1];
  const slip =
    Math.round((stepSpatial[width - 1] - stepTruth[width - 1]) / TAU) || 0;
  return (
    <div className="unwrap-lesson">
      <div className="lesson-instruction">
        <p className="unwrap-intro">
          {t(
            <>
              <strong>角度歸零不等於表面跳變。</strong>Wrapped Phase
              像時鐘，走過 +π 就從 −π 重來；Unwrapping 要補回漏掉的整圈
              2π，不是把曲線平滑掉。
            </>,
            <>
              <strong>A wrap back to −π is not a jump in the surface.</strong>{" "}
              Wrapped phase works like a clock: past +π it starts again from −π.
              Unwrapping restores the missing whole cycles of 2π; it does not
              smooth the curve.
            </>,
          )}
        </p>
      </div>
      <section
        className="lesson-panel unwrap-panel"
        aria-label={t("逐點解開相位跳變", "Unwrap phase jumps pixel by pixel")}
      >
        <div className="lesson-plot-heading">
          <h2>
            {t(
              "1. 在跳變處，親手補回一圈",
              "1. At a jump, add back a cycle by hand",
            )}
          </h2>
          <span>2π rad = 360°</span>
        </div>
        <p>
          {t(
            <>
              白線是目前像素 x，藍點是左鄰居 x −
              1。假設兩點真實相差不到半圈（π），找最短的角度差。
            </>,
            <>
              The white line is the current pixel x; the blue dot is its left
              neighbor x − 1. Assume the two truly differ by less than half a
              cycle (π), and find the shortest angle difference.
            </>,
          )}
        </p>
        <div className="unwrap-workbench" data-testid="unwrap-workbench">
          <div className="unwrap-plot">
            <div className="lesson-chart-legend">
              <span style={{ color: PURPLE }}>
                {t(
                  "紫色：量測得到的 Wrapped Phase",
                  "Purple: measured wrapped phase",
                )}
              </span>
              {showUnwrapped && (
                <span style={{ color: GREEN }}>
                  {t(
                    <>綠色：Relative Unwrapped Phase（k = {periodOffset}）</>,
                    <>Green: relative unwrapped phase (k = {periodOffset})</>,
                  )}
                </span>
              )}
            </div>
            <p className="lesson-axis-description">
              {t(
                "縱軸＝相位（rad） · 橫軸＝影像像素 x · 點擊、拖曳或用方向鍵選像素",
                "Vertical axis = phase (rad) · Horizontal axis = image pixel x · Click, drag or use the arrow keys to pick a pixel",
              )}
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
                {t("找下一個跳變", "Find the next jump")}
                <ArrowRight size={18} />
              </button>
              <div
                className="unwrap-pixel-controls"
                role="group"
                aria-label={t("逐點選擇像素", "Step through pixels")}
              >
                <button
                  className="lesson-secondary"
                  aria-label={t("前一個像素", "Previous pixel")}
                  disabled={probeX === 0}
                  onClick={() => onSelectX((probeX - 1) / (width - 1))}
                >
                  <ArrowLeft size={17} />
                </button>
                <span data-testid="unwrap-pixel-index">x = {probeX}</span>
                <button
                  className="lesson-secondary"
                  aria-label={t("下一個像素", "Next pixel")}
                  disabled={probeX === width - 1}
                  onClick={() => onSelectX((probeX + 1) / (width - 1))}
                >
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          </div>
          <div
            className="unwrap-inspector"
            aria-label={t(
              "所選像素的數值與公式",
              "Values and formula for the selected pixel",
            )}
          >
            <div className="unwrap-numbers">
              <div>
                <span>{t("左鄰居 φ(x − 1)", "Left neighbor φ(x − 1)")}</span>
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
                <span>{t("目前像素 φ(x)", "Current pixel φ(x)")}</span>
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
                <span>
                  {t("直接相減 d = 右 − 左", "Raw difference d = right − left")}
                </span>
                <b
                  data-testid="unwrap-raw-delta"
                  data-value={transition.rawDelta ?? undefined}
                >
                  {rad(transition.rawDelta)} <small>rad</small>
                </b>
              </div>
              <div className="unwrap-corrected">
                <span>
                  {t("最短相位差 d′", "Shortest phase difference d′")}
                </span>
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
                    ? t("新區段的相對起點", "Relative start of a new segment")
                    : t("無效像素，不補值", "Invalid pixel, left unfilled")}
                  {t("：", ": ")}
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
                ? t(
                    "這兩點沒有跨過 ±π 邊界，直接用原始差值。",
                    "These two pixels don't cross the ±π boundary, so use the raw difference as is.",
                  )
                : t(
                    "直接相減看起來跳了將近一整圈；若表面足夠連續，應選擇較小的那個相位差。",
                    "The raw difference looks like a jump of almost a full cycle; if the surface is continuous enough, pick the smaller phase difference.",
                  )}
            </p>
            <div className="unwrap-quiz">
              <strong>
                {t(
                  "現在試算：你會怎麼修正這個差值？",
                  "Try it now: how would you correct this difference?",
                )}
              </strong>
              <div
                className="unwrap-controls"
                role="group"
                aria-label={t("選擇跨界修正", "Choose a wrap correction")}
              >
                {[
                  { periods: 1, label: t("加 2π", "Add 2π") },
                  { periods: 0, label: t("不加不減", "Leave it as is") },
                  { periods: -1, label: t("減 2π", "Subtract 2π") },
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
                    ? t(
                        "在連續性假設下，這樣接：",
                        "Under the continuity assumption, this connects as:",
                      )
                    : t(
                        "還不符合最短相位差。你選的結果是：",
                        "That's not the shortest phase difference yet. Your choice gives:",
                      )}{" "}
                  {rad(transition.rawDelta! + choice * TAU)}{" "}
                  {t("rad。", "rad.")}
                  {choice !== transition.periodAdjustment &&
                    t(
                      ` 試試「${correction}」，讓差值落在 −π 到 +π 之間。`,
                      ` Try "${correction}" so the difference falls between −π and +π.`,
                    )}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="unwrap-transition" data-testid="unwrap-transition-note">
            {transition.kind === "invalid"
              ? t(
                  "此像素無效：保持 N/A，不補值，也不跨過缺口串接。",
                  "This pixel is invalid: it stays N/A, isn't filled in, and nothing is connected across the gap.",
                )
              : transition.kind === "anchor"
                ? t(
                    "這是新區段起點：暫把這個 Wrapped Phase 當相對錨點，不借用前一區段的整數週期。",
                    "This is the start of a new segment: its wrapped phase serves as a temporary relative anchor, without borrowing whole cycles from the previous segment.",
                  )
                : t(
                    "相位差在數值容差內接近 π；兩個方向幾乎同樣短，本教學不把這個方向判定當作可靠答案。",
                    "The phase difference is within numerical tolerance of π; both directions are almost equally short, so this lesson doesn't treat the chosen direction as a reliable answer.",
                  )}
          </p>
        )}
        <button
          className="lesson-primary"
          aria-pressed={showUnwrapped}
          onClick={() => setShowUnwrapped((v) => !v)}
        >
          {showUnwrapped
            ? t("只看 Wrapped Phase", "Show wrapped phase only")
            : t("套用 Spatial Unwrap", "Apply spatial unwrap")}
        </button>
        <p className="lesson-caption">
          {t(
            <>
              綠線：逐點累積最短相位差，和 3D 沙盒用的是同一個{" "}
              <code>unwrapRows</code>。
            </>,
            <>
              Green line: shortest phase differences accumulated pixel by pixel,
              using the same <code>unwrapRows</code> as the 3D sandbox.
            </>,
          )}
        </p>
        <details className="lesson-formula">
          <summary>
            {t(
              "公式如何寫？展開逐點遞推式",
              "What's the formula? Expand the per-pixel recurrence",
            )}
          </summary>
          <code>
            d = φ(x) − φ(x − 1)
            <br />
            d′ = wrap(d) ∈ [−π, π)
            <br />
            Φ(x) = Φ(x − 1) + d′
          </code>
          <p>
            {t(
              <>
                d 小於 −π 時加 2π；大於 +π 時減 2π；介於兩者之間則不改。恰好 π
                時方向有歧義，程式雖有區間慣例，仍不能據此判定真實方向。
              </>,
              <>
                If d is below −π, add 2π; if it's above +π, subtract 2π;
                otherwise leave it. At exactly π the direction is ambiguous: the
                code follows an interval convention, but that can't tell you the
                true direction.
              </>,
            )}
          </p>
          <p>
            {t(
              <>
                每個有效區段從 Φ(x₀) = φ(x₀) 開始，相當於暫選起點 k =
                0；這不是測出了真實的絕對條紋序號。
              </>,
              <>
                Each valid segment starts at Φ(x₀) = φ(x₀), which amounts to
                picking k = 0 for its start; it is not a measurement of the true
                absolute fringe order.
              </>,
            )}
          </p>
        </details>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label={t(
          "相對相位的整數週期歧義",
          "Whole-cycle ambiguity of relative phase",
        )}
      >
        <div className="lesson-plot-heading">
          <h2>
            {t(
              "2. 接得連續，仍然不知道第幾圈",
              "2. Continuous, yet you still don't know which cycle",
            )}
          </h2>
        </div>
        <p>
          {t(
            <>
              把整條連續曲線加上或減去 2π，重新 Wrapped
              之後仍得到同樣的角度。所以上面的連續性假設，可以找回區段內相對跨了幾圈，卻不能決定起點的那一圈。
            </>,
            <>
              Add or subtract 2π to the whole continuous curve, wrap it again,
              and you get the same angles. So the continuity assumption above
              can recover how many cycles a segment crosses, but not which cycle
              its start is in.
            </>,
          )}
        </p>
        <div
          className="unwrap-controls"
          role="group"
          aria-label={t(
            "假設未知的整數週期偏移",
            "Assume an unknown whole-cycle offset",
          )}
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
              {t("假設 k = ", "Assume k = ")}
              {k > 0 ? "+" : ""}
              {k}
            </button>
          ))}
        </div>
        <div className="unwrap-equivalence">
          <div>
            <span>{t("候選 Φ + 2πk", "Candidate Φ + 2πk")}</span>
            <b
              data-testid="unwrap-candidate-value"
              data-value={finite(candidate)}
            >
              {rad(candidate)}
            </b>
            <small>
              {t(
                "rad · 一種可能的展開結果",
                "rad · one possible unwrapped result",
              )}
            </small>
          </div>
          <div>
            <span>{t("再 Wrapped 一次", "Wrapped again")}</span>
            <b
              data-testid="unwrap-rewrapped-value"
              data-value={finite(rewrapped)}
            >
              {rad(rewrapped)}
            </b>
            <small>
              {t("rad · 回到一圈內", "rad · back within one cycle")}
            </small>
          </div>
          <div>
            <span>
              {t("原本量測的 Wrapped", "Originally measured wrapped")}
            </span>
            <b
              data-testid="unwrap-wrapped-value"
              data-value={finite(data.wrapped[probeX])}
            >
              {rad(data.wrapped[probeX])}
            </b>
            <small>{t("rad · 不因 k 而改變", "rad · unchanged by k")}</small>
          </div>
        </div>
        <p className="unwrap-warning" data-testid="unwrap-absolute-warning">
          {t(
            <>
              <strong>這仍是 Relative Phase，不是深度。</strong> 單一頻率的
              Spatial Unwrap
              無法決定絕對條紋序號；每個不連通的區段還各自差一個未知的整數圈。
            </>,
            <>
              <strong>This is still relative phase, not depth.</strong>{" "}
              Single-frequency spatial unwrapping can't determine the absolute
              fringe order, and each disconnected segment is off by its own
              unknown whole number of cycles.
            </>,
          )}
        </p>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label={t(
          "Unwrap 的假設與失敗情況",
          "Unwrapping assumptions and failure cases",
        )}
      >
        <div className="lesson-plot-heading">
          <h2>
            {t(
              "3. 這種接法，什麼時候不能相信？",
              "3. When can't you trust this?",
            )}
          </h2>
        </div>
        <p>
          {t(
            <>
              <strong>相鄰真實相位差的絕對值必須小於 π。</strong>{" "}
              如果有深度斷層、條紋太密而取樣不足，或雜訊把差值推過邊界，最短路徑可能接錯一整圈。曲線看起來連續，不代表接對；單靠
              Wrapped Phase 也無法驗證這個假設。
            </>,
            <>
              <strong>
                The true phase difference between neighbors must be smaller than
                π.
              </strong>{" "}
              With a depth step, fringes too dense to sample, or noise pushing a
              difference past the boundary, the shortest path can be off by a
              whole cycle. A continuous-looking curve isn't necessarily right,
              and the wrapped phase alone can't verify this assumption.
            </>,
          )}
        </p>
        <div className="unwrap-step-demo" data-testid="unwrap-step-demo">
          <p>
            {t(
              <>
                下面改用 {FINE} 週期的條紋（和下一步相同），在 x = {x0}{" "}
                放一個深度斷層。拖動滑桿，找出 Spatial 從哪個高度開始接錯。
              </>,
              <>
                Below, the fringes switch to {FINE} periods (same as the next
                step) with a depth step at x = {x0}. Drag the slider to find the
                height where Spatial starts to go wrong.
              </>,
            )}
          </p>
          <label className="unwrap-slider">
            <span>
              {t(
                <>
                  斷層高度：
                  <b data-testid="unwrap-step-cycles">
                    {stepCycles.toFixed(2)}
                  </b>{" "}
                  圈
                  <small>
                    （斷層兩側相差 {rad(localJump)} rad
                    {localJump > Math.PI ? "，超過 π" : "，小於 π"}）
                  </small>
                </>,
                <>
                  Depth step:{" "}
                  <b data-testid="unwrap-step-cycles">
                    {stepCycles.toFixed(2)}
                  </b>{" "}
                  cycles
                  <small>
                    {" "}
                    (the two sides differ by {rad(localJump)} rad
                    {localJump > Math.PI ? ", more than π" : ", less than π"})
                  </small>
                </>,
              )}
            </span>
            <input
              type="range"
              min={0}
              max={MAX_STEP_CYCLES}
              step={0.05}
              value={stepCycles}
              onChange={(e) => onStepCycles(Number(e.target.value))}
            />
          </label>
          <div className="lesson-chart-legend">
            <span style={{ color: GREEN }}>
              {t("綠色：Spatial 結果", "Green: Spatial result")}
            </span>
            <span style={{ color: TRUTH }}>
              {t(
                "灰色虛線：合成真值（只用來對照）",
                "Gray dashed: synthetic ground truth (for reference only)",
              )}
            </span>
          </div>
          <LineChart
            compact
            series={[
              {
                values: stepTruth,
                color: TRUTH,
                label: t("合成真值", "Synthetic ground truth"),
                dashed: true,
              },
              {
                values: stepSpatial,
                color: GREEN,
                label: t("Spatial 結果", "Spatial result"),
              },
            ]}
            min={0}
            max={TAU * FINE}
            yLabels={[1, 0.75, 0.5, 0.25, 0].map((t) =>
              (t * TAU * FINE).toFixed(0),
            )}
            selected={x0 / (width - 1)}
            xLabels={[0, 0.25, 0.5, 0.75, 1].map((t) =>
              String(Math.round(t * (width - 1))),
            )}
            testId="unwrap-step-chart"
          />
          <p
            className={slip ? "unwrap-feedback" : "unwrap-feedback correct"}
            data-testid="unwrap-step-result"
            role="status"
          >
            {slip
              ? t(
                  `斷層之後整段少了 ${-slip} 圈（${rad(slip * TAU)} rad）。曲線仍然連續，看不出接錯；這就是 Spatial 的盲點。`,
                  `After the step, the whole segment is ${-slip} ${slip === -1 ? "cycle" : "cycles"} short (${rad(slip * TAU)} rad). The curve still looks continuous, so you can't see the error; this is Spatial's blind spot.`,
                )
              : t(
                  "斷層兩側相差不到半圈，最短相位差仍然是對的，Spatial 接得起來。",
                  "The two sides differ by less than half a cycle, so the shortest phase difference is still right and Spatial connects them correctly.",
                )}
          </p>
        </div>
        <label className="unwrap-gap-toggle">
          <input
            type="checkbox"
            checked={showGap}
            onChange={(e) => {
              setShowGap(e.target.checked);
              setShowUnwrapped(true);
            }}
          />
          {t(
            "加入無效區段（教學遮罩）",
            "Add an invalid segment (teaching mask)",
          )}
        </label>
        <p className="unwrap-segments" data-testid="unwrap-segment-count">
          {t(
            `${data.segmentCount} 個獨立連續區段`,
            `${data.segmentCount} independent continuous ${data.segmentCount === 1 ? "segment" : "segments"}`,
          )}
        </p>
        {data.gap && (
          <>
            <p data-testid="unwrap-gap-note">
              {t(
                <>
                  將 x = {data.gap.start}…{data.gap.end - 1} 標成無效，上方第 1
                  段的綠線會在這裡斷開；缺口後重新起算，兩段之間差幾圈無從得知。
                </>,
                <>
                  Pixels x = {data.gap.start}…{data.gap.end - 1} are marked
                  invalid, so the green line of segment 1 above breaks here. It
                  starts over after the gap, and there's no way to know how many
                  cycles apart the two segments are.
                </>,
              )}
            </p>
            <button
              className="lesson-secondary"
              onClick={() => onSelectX(data.gap!.end / (width - 1))}
            >
              {t("看無效區段後的起點", "See where it restarts after the gap")}
              <ArrowRight size={18} />
            </button>
          </>
        )}
      </section>

      <div className="lesson-takeaway">
        <strong>{t("這一步要記住", "Key takeaways")}</strong>
        <p>
          {t(
            <>
              <b>Spatial Unwrapping</b>{" "}
              借用旁邊的像素，只能得到相對相位；遇到超過半圈的斷層或缺口，就會整段差一圈，而且看不出來。
            </>,
            <>
              <b>Spatial Unwrapping</b> borrows from neighboring pixels, so it
              only gives relative phase. A depth step of more than half a cycle,
              or a gap, puts a whole segment off by a cycle, and you can't tell.
            </>,
          )}
        </p>
        <p>
          {t(
            <>
              下一步的 <b>Temporal Unwrapping</b>{" "}
              對同一個像素多拍幾組頻率，每個像素自己決定第幾圈，斷層也不怕。
            </>,
            <>
              In the next step, <b>Temporal Unwrapping</b> captures several
              frequencies for the same pixel, so each pixel finds its own cycle
              and depth steps are no problem.
            </>,
          )}
        </p>
      </div>
    </div>
  );
}
