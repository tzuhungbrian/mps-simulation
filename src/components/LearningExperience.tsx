import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ScanLine } from "lucide-react";
import {
  DEFAULT_CONFIG,
  wrapPhase,
  type SimulationConfig,
  type SimulationResult,
} from "../core/simulation";
import { rasterize } from "../lib/images";
import { t } from "../i18n";
import LineChart from "./LineChart";
import PhaseUnwrappingLesson from "./PhaseUnwrappingLesson";
import TemporalUnwrappingLesson from "./TemporalUnwrappingLesson";

const LessonScene = lazy(() => import("./LessonScene"));

const COLORS = ["#5ee4bd", "#b7a0fa", "#edbd79"];
interface Props {
  config: SimulationConfig;
  result: SimulationResult;
  probeX: number;
  probeY: number;
  onApplyConfig: (next: SimulationConfig) => void;
  onSelectX: (fraction: number) => void;
  onChoosePixel: (x: number, y: number) => void;
  onExplore: () => void;
  onSandbox: () => void;
  onReadNotes: () => void;
  onReadLimits: () => void;
  nav?: ReactNode;
  initialStep?: number;
}
function Capture({
  frame,
  width,
  height,
  k,
  probeX,
  probeY,
  onChoosePixel,
}: {
  frame: Float64Array;
  width: number;
  height: number;
  k: number;
  probeX: number;
  probeY: number;
  onChoosePixel: Props["onChoosePixel"];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    c.getContext("2d")?.drawImage(
      rasterize(frame, width, height, "intensity"),
      0,
      0,
    );
  }, [frame, width, height]);
  return (
    <figure className="lesson-capture">
      <figcaption>
        <span className="lesson-dot" style={{ background: COLORS[k] }} />
        {t(
          <>
            第 {k + 1} 張{" "}
            <span>
              I{k + 1} · 相移 {k * 120}°
            </span>
          </>,
          <>
            Image {k + 1}{" "}
            <span>
              I{k + 1} · phase shift {k * 120}°
            </span>
          </>,
        )}
      </figcaption>
      <div
        className="lesson-image"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onChoosePixel(
            Math.max(
              0,
              Math.min(
                width - 1,
                Math.floor(((e.clientX - r.left) / r.width) * width),
              ),
            ),
            Math.max(
              0,
              Math.min(
                height - 1,
                Math.floor(((e.clientY - r.top) / r.height) * height),
              ),
            ),
          );
        }}
      >
        <canvas
          data-testid={`guide-capture-${k}`}
          ref={canvas}
          aria-label={t(
            `第${k + 1}張合成條紋影像，點擊選擇同一個像素`,
            `Synthetic fringe image ${k + 1}; click to pick the same pixel`,
          )}
        />
        <span
          className="lesson-crosshair"
          style={{
            left: `${((probeX + 0.5) / width) * 100}%`,
            top: `${((probeY + 0.5) / height) * 100}%`,
          }}
        />
      </div>
    </figure>
  );
}
export default function LearningExperience({
  config,
  result,
  probeX,
  probeY,
  onApplyConfig,
  onSelectX,
  onChoosePixel,
  onExplore,
  onSandbox,
  onReadNotes,
  onReadLimits,
  nav,
  initialStep,
}: Props) {
  const [step, setStep] = useState(0),
    [relative, setRelative] = useState(false),
    [sceneFrame, setSceneFrame] = useState(0),
    [autoplay, setAutoplay] = useState(true),
    [stepCycles, setStepCycles] = useState(0.3);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step !== 1 || !autoplay) return;
    const timer = setInterval(() => setSceneFrame((k) => (k + 1) % 3), 1400);
    return () => clearInterval(timer);
  }, [step, autoplay]);
  useEffect(() => {
    if (step > 0) heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);
  const row = probeY * config.width,
    index = row + probeX,
    selected = probeX / (config.width - 1);
  const values = result.captures.frames.map((frame) => frame[index]);
  const phase = result.phase.wrapped[index];
  const intensity = result.captures.frames.map((frame, k) => ({
    values: frame.subarray(row, row + config.width),
    color: COLORS[k],
    label: `I${k + 1}`,
  }));
  const phases = [
    {
      values: result.phase.wrapped.subarray(row, row + config.width),
      color: COLORS[1],
      label: "Wrapped Phase",
    },
    ...(relative
      ? [
          {
            values: result.unwrapped.subarray(row, row + config.width),
            color: COLORS[0],
            label: "Relative Unwrapped",
          },
        ]
      : []),
  ];
  let min = -Math.PI,
    max = Math.PI;
  if (relative)
    for (const value of result.unwrapped.subarray(row, row + config.width)) {
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  const start = () => {
    onApplyConfig({
      ...DEFAULT_CONFIG,
      width: config.width,
      height: config.height,
      frequency: 2,
    });
    onSelectX(0.25);
    setRelative(false);
    setStep(1);
  };
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialStep || initialStep < 1 || initialStep > 5)
      return;
    opened.current = true;
    start();
    setStep(initialStep);
  }, []);
  const stepTitles = [
    "",
    t(
      "第 1 步：同一個場景，拍三次。",
      "Step 1: Capture the same scene three times.",
    ),
    t(
      "第 2 步：讀同一個點的三次亮度。",
      "Step 2: Read the three intensities of one point.",
    ),
    t(
      "第 3 步：三個亮度，換成一個 Phase。",
      "Step 3: Turn three intensities into one phase.",
    ),
    t(
      "第 4 步：Spatial Unwrapping，借鄰居補回整圈。",
      "Step 4: Spatial unwrapping borrows from neighbors to restore whole cycles.",
    ),
    t(
      "第 5 步：Temporal Unwrapping，每個像素自己決定第幾圈。",
      "Step 5: Temporal unwrapping lets each pixel find its own cycle.",
    ),
  ];
  const next = () => {
    setRelative(false);
    setStep((s) => Math.min(5, s + 1));
  };
  return (
    <div className="learning-shell">
      <header className="learning-header">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setStep(0);
          }}
          className="learning-brand"
        >
          <ScanLine size={25} />
          <span>
            {t(
              <>
                結構光實驗室<small>Structured Light Lab</small>
              </>,
              <>
                Structured Light Lab<small>Step by step</small>
              </>,
            )}
          </span>
        </a>
        {nav}
      </header>
      <main
        className={`learning-main ${step >= 4 ? "with-unwrapping" : step > 0 ? "with-scene" : ""}`}
      >
        <div className="lesson-kicker">
          {t(
            "一步一步學 · Phase Shifting 與 Unwrapping",
            "Step by step · Phase shifting and unwrapping",
          )}
        </div>
        {step === 0 ? (
          <section className="lesson-welcome">
            <h1>
              {t(
                "三張照片，算出條紋的位置。",
                "Three photos, one position on the fringe.",
              )}
            </h1>
            <p className="lesson-intro" data-testid="lesson-intro">
              {t(
                <>
                  相機只會記錄「亮度」，不會直接告訴我們深度。這一課先學會：如何用三次不同的亮度，算出一個點位於條紋的哪個位置。接著親手試算兩種
                  Phase Unwrapping：Spatial 借鄰居補回整圈，Temporal
                  用多組頻率求出絕對相位，最後換成 Projector 像素。
                </>,
                <>
                  A camera only records intensity; it never tells you depth
                  directly. In this lesson you first learn how three different
                  intensities reveal where a point sits on a fringe. Then you
                  try two kinds of phase unwrapping yourself: spatial borrows
                  from neighbors to restore whole cycles, and temporal uses
                  several frequencies to find the absolute phase, which finally
                  becomes a projector pixel.
                </>,
              )}
            </p>
            <p className="lesson-key-idea">
              {t(
                "Phase 是條紋內的位置，不是物體高度。",
                "Phase is a position within a fringe, not the object's height.",
              )}
            </p>
            <div
              className="lesson-overview lesson-overview-five"
              aria-label={t("學習流程", "Lesson flow")}
            >
              <div>
                <b>1</b>
                <span>
                  {t(
                    <>
                      看三張照片<small>條紋依序平移</small>
                    </>,
                    <>
                      See three photos<small>Fringes shift in turn</small>
                    </>,
                  )}
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>2</b>
                <span>
                  {t(
                    <>
                      讀一個點<small>得到三個亮度</small>
                    </>,
                    <>
                      Read one point<small>Get three intensities</small>
                    </>,
                  )}
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>3</b>
                <span>
                  {t(
                    <>
                      算出 Phase<small>找到條紋內的位置</small>
                    </>,
                    <>
                      Compute phase<small>Find the position in a fringe</small>
                    </>,
                  )}
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>4</b>
                <span>
                  {t(
                    <>
                      Spatial 解包<small>借鄰居補回 2π</small>
                    </>,
                    <>
                      Spatial unwrapping<small>Borrow 2π from neighbors</small>
                    </>,
                  )}
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>5</b>
                <span>
                  {t(
                    <>
                      Temporal 解包<small>求出絕對相位</small>
                    </>,
                    <>
                      Temporal unwrapping<small>Find the absolute phase</small>
                    </>,
                  )}
                </span>
              </div>
            </div>
            <div className="lesson-start">
              <button className="lesson-primary" onClick={start}>
                {t("開始：先看三張照片", "Start: look at three photos")}
                <ArrowRight size={20} />
              </button>
              <p>
                {t(
                  "不需要先看公式。每一步都有「做什麼、看哪裡、代表什麼」。",
                  "No formulas needed up front. Every step tells you what to do, where to look, and what it means.",
                )}
              </p>
              <p className="lesson-fineprint">
                {t(
                  "開始會套用乾淨的教學參數，不會覆寫你已保存的設定。",
                  "Starting applies clean teaching parameters; your saved settings are not overwritten.",
                )}
              </p>
            </div>
            <div className="lesson-scope">
              <strong>
                {t(
                  "這堂課先學相位；3D 重建到沙盒裡看。",
                  "This lesson covers phase; see 3D reconstruction in the sandbox.",
                )}
              </strong>
              <p>
                {t(
                  <>
                    本課使用理想化一維影像，不含物體遮擋。3D 沙盒另有已知
                    Camera–Projector
                    Calibration、遮擋判斷與三角量測；仍非完整物理 Scanner。
                  </>,
                  <>
                    This lesson uses idealized 1D images with no occlusion. The
                    3D sandbox adds known camera–projector calibration,
                    occlusion checks, and triangulation; it is still not a full
                    physical scanner.
                  </>,
                )}
              </p>
              <button onClick={onReadLimits}>
                {t("查看完整實作邊界", "See the full implementation scope")}
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        ) : (
          <>
            <nav
              className="lesson-progress lesson-progress-five"
              aria-label={t("教學進度", "Lesson progress")}
            >
              {t(
                ["看照片", "讀亮度", "算相位", "Spatial", "Temporal"],
                ["Photos", "Intensity", "Phase", "Spatial", "Temporal"],
              ).map((title, i) => (
                <button
                  key={title}
                  className={
                    step === i + 1 ? "current" : step > i + 1 ? "complete" : ""
                  }
                  aria-current={step === i + 1 ? "step" : undefined}
                  onClick={() => {
                    setRelative(false);
                    setStep(i + 1);
                  }}
                >
                  <b>{step > i + 1 ? <Check size={16} /> : i + 1}</b>
                  {title}
                </button>
              ))}
            </nav>
            <h1 className="lesson-step-title" ref={heading} tabIndex={-1}>
              {stepTitles[step]}
            </h1>
            {step < 4 && (
              <p className="lesson-key-idea">
                {t(
                  "Phase 是條紋內的位置，不是物體高度。",
                  "Phase is a position within a fringe, not the object's height.",
                )}
              </p>
            )}
            <div className="lesson-step-layout">
              <div className="lesson-step-content">
                {step === 1 ? (
                  <>
                    <div className="lesson-instruction">
                      <strong>{t("先看這裡", "Look here first")}</strong>
                      <p>
                        {t(
                          <>
                            下面不是三個物體，而是
                            <strong>同一個場景的三次曝光</strong>
                            。每次只把 Projector 的條紋平移 120°。
                          </>,
                          <>
                            These are not three objects but{" "}
                            <strong>three exposures of the same scene</strong>.
                            Each time, only the projector's fringes shift by
                            120°.
                          </>,
                        )}
                      </p>
                    </div>
                    <section
                      className="lesson-panel"
                      aria-label={t("三次曝光", "Three exposures")}
                    >
                      <div className="lesson-captures">
                        {result.captures.frames.map((frame, k) => (
                          <Capture
                            key={k}
                            {...{
                              frame,
                              width: config.width,
                              height: config.height,
                              k,
                              probeX,
                              probeY,
                              onChoosePixel,
                            }}
                          />
                        ))}
                      </div>
                      <p className="lesson-caption">
                        {t(
                          "十字標記指向同一個像素。比較三張圖：這一點有時亮、有時暗。",
                          "The crosshair marks the same pixel. Compare the three images: this point is sometimes bright, sometimes dark.",
                        )}
                      </p>
                      <button
                        className="lesson-secondary"
                        onClick={() =>
                          onApplyConfig({
                            ...config,
                            phaseOffset: wrapPhase(config.phaseOffset - 0.5),
                          })
                        }
                      >
                        {t(
                          "把條紋往右移一點",
                          "Shift the fringes a little to the right",
                        )}
                        <ArrowRight size={18} />
                      </button>
                    </section>
                    <div className="lesson-takeaway">
                      <strong>
                        {t("這一步要記住", "Remember from this step")}
                      </strong>
                      <p>
                        {t(
                          "我們主動改變投影條紋的位置，讓同一個像素產生不同亮度。下一步就讀出這三個數字。",
                          "We deliberately move the projected fringes so the same pixel gets different intensities. Next, you read out those three numbers.",
                        )}
                      </p>
                    </div>
                  </>
                ) : step === 2 ? (
                  <>
                    <div className="lesson-instruction">
                      <strong>{t("現在換你操作", "Your turn")}</strong>
                      <p>
                        {t(
                          <>
                            在曲線上點一下，或拖曳白色直線。你正在選擇
                            <strong>影像裡的一個像素</strong>
                            ，不是改變物體的高度。
                          </>,
                          <>
                            Click the curve or drag the white line. You are
                            choosing <strong>one pixel in the image</strong>,
                            not changing the object's height.
                          </>,
                        )}
                      </p>
                    </div>
                    <section className="lesson-panel">
                      <div className="lesson-plot-heading">
                        <h2>
                          {t(
                            "這個像素，三次各有多亮？",
                            "How bright is this pixel in each shot?",
                          )}
                        </h2>
                        <span>
                          {t(
                            <>
                              x = {probeX}，y = {probeY}
                            </>,
                            <>
                              x = {probeX}, y = {probeY}
                            </>,
                          )}
                        </span>
                      </div>
                      <div
                        className="lesson-readings"
                        data-testid="guide-probe-values"
                      >
                        {values.map((value, k) => (
                          <div
                            key={k}
                            style={
                              {
                                "--reading-color": COLORS[k],
                              } as React.CSSProperties
                            }
                          >
                            <span>
                              {t(
                                <>
                                  第 {k + 1} 張 · I{k + 1}
                                </>,
                                <>
                                  Image {k + 1} · I{k + 1}
                                </>,
                              )}
                            </span>
                            <b>{value.toFixed(3)}</b>
                          </div>
                        ))}
                      </div>
                      <p className="lesson-axis-description">
                        {t(
                          "縱軸＝亮度（0 黑、1 白） · 橫軸＝影像從左到右的位置",
                          "Vertical axis = intensity (0 black, 1 white) · Horizontal axis = position from left to right in the image",
                        )}
                      </p>
                      <LineChart
                        series={intensity}
                        min={0}
                        max={1}
                        selected={selected}
                        onSelect={onSelectX}
                        testId="guide-intensity-chart"
                      />
                      <div className="lesson-plot-footer">
                        <button
                          className="lesson-secondary"
                          onClick={() =>
                            onSelectX(selected > 0.5 ? 0.25 : 0.65)
                          }
                        >
                          {t("換一個像素看看", "Try another pixel")}
                          <ArrowRight size={18} />
                        </button>
                        <span>
                          {t(
                            "三條線分別代表第 1、2、3 張照片。",
                            "The three lines are photos 1, 2, and 3.",
                          )}
                        </span>
                      </div>
                    </section>
                    <div className="lesson-takeaway">
                      <strong>
                        {t("這一步要記住", "Remember from this step")}
                      </strong>
                      <p>
                        {t(
                          <>
                            不要只看一張照片的明暗。把同一個像素的三次亮度一起看，才有足夠資訊算出
                            Phase。
                          </>,
                          <>
                            Don't judge by one photo's brightness alone. Only
                            the three intensities of the same pixel together
                            give you enough information to compute the phase.
                          </>,
                        )}
                      </p>
                    </div>
                  </>
                ) : step === 3 ? (
                  <>
                    <div className="lesson-instruction">
                      <strong>
                        {t(
                          "演算法正在做什麼？",
                          "What is the algorithm doing?",
                        )}
                      </strong>
                      <p>
                        {t(
                          <>
                            把剛才同一像素的{" "}
                            <strong>
                              {values.map((v) => v.toFixed(3)).join("、")}
                            </strong>{" "}
                            輸入三步 Phase Shifting
                            解算，得到下面的角度。這不是從 Ground Truth
                            讀出的答案。
                          </>,
                          <>
                            The same pixel's{" "}
                            <strong>
                              {values.map((v) => v.toFixed(3)).join(", ")}
                            </strong>{" "}
                            go into the three-step phase-shifting solver, which
                            gives the angle below. It is not read from the
                            ground truth.
                          </>,
                        )}
                      </p>
                    </div>
                    <section className="lesson-panel">
                      <div className="lesson-phase-result">
                        <div>
                          <span>
                            {t(
                              "目前像素的 Wrapped Phase",
                              "Wrapped phase of the current pixel",
                            )}
                          </span>
                          <strong data-testid="guide-phase-value">
                            {Number.isFinite(phase) ? phase.toFixed(3) : "N/A"}
                            <small>
                              {Number.isFinite(phase) ? " rad" : ""}
                            </small>
                          </strong>
                        </div>
                        <p>
                          {t(
                            <>
                              一個條紋週期是 360°，也就是 2π rad。這個角度表示
                              <strong>條紋週期內的位置</strong>
                              ；單頻率還不知道它是第幾條條紋。
                            </>,
                            <>
                              One fringe cycle is 360°, or 2π rad. This angle is{" "}
                              <strong>
                                the position within a fringe cycle
                              </strong>
                              ; a single frequency can't yet tell which fringe
                              it is.
                            </>,
                          )}
                        </p>
                      </div>
                      <div className="lesson-plot-heading">
                        <h2>
                          {t(
                            "對每個像素重複解算",
                            "Repeat the solve for every pixel",
                          )}
                        </h2>
                        <span>
                          {t(
                            "橫軸仍是影像位置",
                            "The horizontal axis is still image position",
                          )}
                        </span>
                      </div>
                      <div className="lesson-chart-legend">
                        <span style={{ color: COLORS[1] }}>
                          {t("紫色：Wrapped Phase", "Purple: wrapped phase")}
                        </span>
                        {relative && (
                          <span style={{ color: COLORS[0] }}>
                            {t(
                              "綠色：Relative Unwrapped Phase",
                              "Green: relative unwrapped phase",
                            )}
                          </span>
                        )}
                      </div>
                      <LineChart
                        series={phases}
                        min={min - 0.15}
                        max={max + 0.15}
                        selected={selected}
                        onSelect={onSelectX}
                        testId="guide-phase-chart"
                      />
                      <p className="lesson-caption">
                        {t(
                          <>
                            紫線跳下去不是表面突然變高或變低，而是角度超出 +π
                            後，改用 −π 開始表示。
                          </>,
                          <>
                            When the purple line drops, the surface didn't
                            suddenly change height; the angle passed +π and
                            starts again from −π.
                          </>,
                        )}
                      </p>
                      <button
                        className="lesson-secondary"
                        onClick={() => setRelative((v) => !v)}
                      >
                        {relative
                          ? t("只看 Wrapped Phase", "Show wrapped phase only")
                          : t(
                              "把跳變接起來（1D Unwrap）",
                              "Join the jumps (1D unwrap)",
                            )}
                        <ArrowRight size={18} />
                      </button>
                      {relative && (
                        <p className="lesson-unwrap-explanation">
                          {t(
                            "接起來的是相對 Phase，還不能當作深度。",
                            "The joined curve is relative phase; you can't treat it as depth yet.",
                          )}
                        </p>
                      )}
                      <details className="lesson-formula">
                        <summary>
                          {t(
                            "想知道怎麼算？再展開公式",
                            "Curious about the math? Expand the formula",
                          )}
                        </summary>
                        <p>
                          {t(
                            <>
                              曝光順序為 0°、120°、240°，模型使用 cos(φ +
                              δ)。atan2 以兩個輸入保留象限：
                            </>,
                            <>
                              The exposures are at 0°, 120°, and 240°, and the
                              model uses cos(φ + δ). atan2 keeps the quadrant by
                              taking two inputs:
                            </>,
                          )}
                        </p>
                        <code>φ̂ = atan2(√3(I₃ − I₂), 2I₁ − I₂ − I₃)</code>
                        <p>
                          {t(
                            <>
                              解算只讀取三個量測亮度。1D Unwrap
                              只依相鄰相位差恢復連續區段，不補未知整數週期；它假設相鄰真實相位差的絕對值小於
                              π。
                            </>,
                            <>
                              The solver reads only the three measured
                              intensities. 1D unwrapping restores continuous
                              segments from neighboring phase differences only
                              and doesn't fill in the unknown whole cycles; it
                              assumes the true phase difference between
                              neighbors is smaller than π in magnitude.
                            </>,
                          )}
                        </p>
                      </details>
                    </section>
                    <div className="lesson-takeaway">
                      <strong>
                        {t(
                          "接下來，為什麼需要 Unwrapping？",
                          "Next: why do you need unwrapping?",
                        )}
                      </strong>
                      <p>
                        {t(
                          <>
                            你已從三張照片算出 Wrapped
                            Phase。下一步會親手修正跨過 ±π
                            的相位差，並理解：把曲線接得連續，不代表已知道絕對條紋序號，更不等於完成
                            3D。
                          </>,
                          <>
                            You've computed the wrapped phase from three photos.
                            Next, you'll fix phase differences that cross ±π
                            yourself and see that a continuous curve doesn't
                            mean you know the absolute fringe order, let alone
                            that 3D is done.
                          </>,
                        )}
                      </p>
                      <p className="lesson-quality">
                        {t(
                          <>
                            目前全部像素有效率：
                            {(result.metrics.validRatio * 100).toFixed(1)}
                            %。此數值不是 3D 準確度。
                          </>,
                          <>
                            Valid ratio across all pixels:{" "}
                            {(result.metrics.validRatio * 100).toFixed(1)}
                            %. This is not 3D accuracy.
                          </>,
                        )}
                      </p>
                    </div>
                  </>
                ) : step === 4 ? (
                  <PhaseUnwrappingLesson
                    wrapped={result.phase.wrapped}
                    valid={result.phase.valid}
                    row={row}
                    width={config.width}
                    probeX={probeX}
                    onSelectX={onSelectX}
                    stepCycles={stepCycles}
                    onStepCycles={setStepCycles}
                  />
                ) : (
                  <TemporalUnwrappingLesson
                    width={config.width}
                    probeX={probeX}
                    onSelectX={onSelectX}
                    stepCycles={stepCycles}
                    onStepCycles={setStepCycles}
                  />
                )}
              </div>
              {step < 4 && (
                <aside
                  className="lesson-scene-panel"
                  aria-label={t("3D 示意", "3D illustration")}
                >
                  <h2>
                    {t(
                      "在 3D 空間裡是哪一步？",
                      "Where is this step in 3D space?",
                    )}
                  </h2>
                  <Suspense
                    fallback={
                      <div className="lesson-scene">
                        {t("正在載入 3D 示意…", "Loading 3D illustration…")}
                      </div>
                    }
                  >
                    <LessonScene
                      step={step}
                      frequency={config.frequency}
                      phaseOffset={config.phaseOffset}
                      mean={config.mean}
                      amplitude={config.amplitude}
                      frame={sceneFrame}
                      probe={selected}
                      row={
                        config.height > 1 ? probeY / (config.height - 1) : 0.5
                      }
                      phase={phase}
                      aspect={config.height / config.width}
                    />
                  </Suspense>
                  <div
                    className="lesson-scene-frames"
                    role="group"
                    aria-label={t(
                      "3D 示意顯示的曝光",
                      "Exposure shown in the 3D illustration",
                    )}
                  >
                    {[0, 1, 2].map((k) => (
                      <button
                        key={k}
                        aria-pressed={sceneFrame === k}
                        style={
                          {
                            "--reading-color": COLORS[k],
                          } as React.CSSProperties
                        }
                        onClick={() => {
                          setAutoplay(false);
                          setSceneFrame(k);
                        }}
                      >
                        I{k + 1} · {k * 120}°
                      </button>
                    ))}
                    {step === 1 && (
                      <button
                        aria-pressed={autoplay}
                        onClick={() => setAutoplay((v) => !v)}
                      >
                        {autoplay
                          ? t("暫停輪播", "Pause slideshow")
                          : t("自動輪播", "Autoplay")}
                      </button>
                    )}
                  </div>
                  <p
                    className="lesson-scene-caption"
                    data-testid="lesson-scene-caption"
                  >
                    {step === 1
                      ? t(
                          "Projector（黃）把條紋投到牆上，Camera（藍）從旁邊拍。三張照片之間只有條紋平移 120°，牆、Camera 都沒動。藍框就是 Camera 拍到的範圍，對應左邊的照片。",
                          "The projector (yellow) casts fringes on the wall, and the camera (blue) shoots from the side. Between the three photos only the fringes shift by 120°; the wall and camera stay put. The blue frame is what the camera sees, matching the photos on the left.",
                        )
                      : step === 2
                        ? t(
                            "你選的像素 = Camera 發出的一條射線（藍線），打在牆上的紅點。三個亮度就是這個點在三次投影下的亮度。",
                            "The pixel you picked = one ray from the camera (blue line) hitting the red dot on the wall. The three intensities are that dot's brightness under the three projections.",
                          )
                        : step === 3
                          ? t(
                              `φ̂ 只告訴我們紅點在「某一條條紋內」的位置：這個示意裡，Projector 有多張候選光平面（黃）。單一 Wrapped Phase 分不出是哪一張；這裡不使用真值替你挑答案。下一步先看 Spatial Unwrap 能補回什麼。此圖是理想平面示意，不是重建結果。`,
                              "φ̂ only tells you where the red dot sits within some fringe: in this illustration the projector has several candidate light planes (yellow). A single wrapped phase can't tell which one it is, and we don't use the ground truth to pick for you. Next, see what spatial unwrapping can restore. This is an idealized flat illustration, not a reconstruction.",
                            )
                          : t(
                              "Spatial Unwrap 把相鄰像素接成連續區段，但不知道起點的絕對條紋序號；候選光平面不會自動變成唯一。這裡不突出任何一張，不用真值替你選答案。還需要額外編碼或約束、Camera–Projector Calibration 與 Triangulation，才能得到 3D。此圖只作示意，不參與本頁計算。",
                              "Spatial unwrapping joins neighboring pixels into continuous segments, but it doesn't know the absolute fringe order of the starting point, so the candidate light planes don't become unique. No plane is highlighted here, and we don't use the ground truth to choose for you. You still need extra coding or constraints, camera–projector calibration, and triangulation to get 3D. This illustration is not part of this page's computation.",
                            )}
                  </p>
                  <button className="lesson-secondary" onClick={onSandbox}>
                    {t(
                      "到 3D 沙盒看真實掃描",
                      "See a real scan in the 3D sandbox",
                    )}
                    <ArrowRight size={18} />
                  </button>
                </aside>
              )}
            </div>
            <footer className="lesson-actions">
              <button
                className="lesson-secondary"
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={18} />
                {step === 1
                  ? t("回到介紹", "Back to intro")
                  : t("上一步", "Previous")}
              </button>
              {step < 5 ? (
                <button className="lesson-primary" onClick={next}>
                  {step === 1
                    ? t("下一步：讀取一個像素", "Next: read one pixel")
                    : step === 2
                      ? t("下一步：算出 Phase", "Next: compute the phase")
                      : step === 3
                        ? t(
                            "下一步：理解 Phase Unwrapping",
                            "Next: understand phase unwrapping",
                          )
                        : t(
                            "下一步：Temporal Unwrapping",
                            "Next: temporal unwrapping",
                          )}
                  <ArrowRight size={19} />
                </button>
              ) : (
                <button className="lesson-secondary" onClick={onExplore}>
                  {t("自由實驗", "Playground")}
                  <ArrowRight size={19} />
                </button>
              )}
            </footer>
          </>
        )}
        <footer className="learning-footer">
          <button onClick={onReadNotes}>
            <BookOpen size={18} />
            {t("閱讀完整原理筆記", "Read the full notes")}
          </button>
          <span>
            {t(
              "理想化合成影像 · 沒有 3D 重建 · 參數與計算留在本機",
              "Idealized synthetic images · No 3D reconstruction · Parameters and computation stay on your device",
            )}
          </span>
        </footer>
      </main>
    </div>
  );
}
