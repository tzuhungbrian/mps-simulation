import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ScanLine } from "lucide-react";
import {
  DEFAULT_CONFIG,
  wrapPhase,
  type SimulationConfig,
  type SimulationResult,
} from "../core/simulation";
import { rasterize } from "../lib/images";
import LineChart from "./LineChart";
import PhaseUnwrappingLesson from "./PhaseUnwrappingLesson";

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
        <span className="lesson-dot" style={{ background: COLORS[k] }} />第{" "}
        {k + 1} 張{" "}
        <span>
          I{k + 1} · 相移 {k * 120}°
        </span>
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
          aria-label={`第${k + 1}張合成條紋影像，點擊選擇同一個像素`}
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
}: Props) {
  const [step, setStep] = useState(0),
    [relative, setRelative] = useState(false),
    [sceneFrame, setSceneFrame] = useState(0),
    [autoplay, setAutoplay] = useState(true);
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
  const stepTitles = [
    "",
    "第 1 步：同一個場景，拍三次。",
    "第 2 步：讀同一個點的三次亮度。",
    "第 3 步：三個亮度，換成一個 Phase。",
    "第 4 步：Phase Unwrapping，補回整圈。",
  ];
  const next = () => {
    setRelative(false);
    setStep((s) => Math.min(4, s + 1));
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
            結構光實驗室<small>Structured Light Lab</small>
          </span>
        </a>
        <div className="learning-header-actions">
          <button className="sandbox-entry-button" onClick={onSandbox}>
            進入 3D 沙盒
            <ArrowRight size={18} />
          </button>
          <button className="lesson-secondary" onClick={onExplore}>
            自由實驗
            <ArrowRight size={18} />
          </button>
        </div>
      </header>
      <main
        className={`learning-main ${step === 4 ? "with-unwrapping" : step > 0 ? "with-scene" : ""}`}
      >
        <div className="lesson-kicker">
          一步一步學 · Phase Shifting 與 Unwrapping
        </div>
        {step === 0 ? (
          <section className="lesson-welcome">
            <h1>三張照片，算出條紋的位置。</h1>
            <p className="lesson-intro" data-testid="lesson-intro">
              相機只會記錄「亮度」，不會直接告訴我們深度。這一課先學會：如何用三次不同的亮度，算出一個點位於條紋的哪個位置。接著親手試算
              Phase Unwrapping，理解怎麼補回整圈，以及為什麼這還不是深度。
            </p>
            <p className="lesson-key-idea">
              Phase 是條紋內的位置，不是物體高度。
            </p>
            <div
              className="lesson-overview lesson-overview-four"
              aria-label="學習流程"
            >
              <div>
                <b>1</b>
                <span>
                  看三張照片<small>條紋依序平移</small>
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>2</b>
                <span>
                  讀一個點<small>得到三個亮度</small>
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>3</b>
                <span>
                  算出 Phase<small>找到條紋內的位置</small>
                </span>
              </div>
              <ArrowRight />
              <div>
                <b>4</b>
                <span>
                  解開週期<small>補回整圈 2π</small>
                </span>
              </div>
            </div>
            <div className="lesson-start">
              <button className="lesson-primary" onClick={start}>
                開始：先看三張照片
                <ArrowRight size={20} />
              </button>
              <p>不需要先看公式。每一步都有「做什麼、看哪裡、代表什麼」。</p>
              <p className="lesson-fineprint">
                開始會套用乾淨的教學參數，不會覆寫你已保存的設定。
              </p>
            </div>
            <div className="lesson-scope">
              <strong>這堂課先學相位；3D 重建到沙盒裡看。</strong>
              <p>
                本課使用理想化一維影像，不含物體遮擋。3D 沙盒另有已知
                Camera–Projector Calibration、遮擋判斷與三角量測；仍非完整物理
                Scanner。
              </p>
              <button onClick={onReadLimits}>
                查看完整實作邊界
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        ) : (
          <>
            <nav
              className="lesson-progress lesson-progress-four"
              aria-label="教學進度"
            >
              {["看照片", "讀亮度", "算相位", "解開週期"].map((title, i) => (
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
            {step !== 4 && (
              <p className="lesson-key-idea">
                Phase 是條紋內的位置，不是物體高度。
              </p>
            )}
            <div className="lesson-step-layout">
              <div className="lesson-step-content">
                {step === 1 ? (
                  <>
                    <div className="lesson-instruction">
                      <strong>先看這裡</strong>
                      <p>
                        下面不是三個物體，而是
                        <strong>同一個場景的三次曝光</strong>
                        。每次只把 Projector 的條紋平移 120°。
                      </p>
                    </div>
                    <section className="lesson-panel" aria-label="三次曝光">
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
                        十字標記指向同一個像素。比較三張圖：這一點有時亮、有時暗。
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
                        把條紋往右移一點
                        <ArrowRight size={18} />
                      </button>
                    </section>
                    <div className="lesson-takeaway">
                      <strong>這一步要記住</strong>
                      <p>
                        我們主動改變投影條紋的位置，讓同一個像素產生不同亮度。下一步就讀出這三個數字。
                      </p>
                    </div>
                  </>
                ) : step === 2 ? (
                  <>
                    <div className="lesson-instruction">
                      <strong>現在換你操作</strong>
                      <p>
                        在曲線上點一下，或拖曳白色直線。你正在選擇
                        <strong>影像裡的一個像素</strong>，不是改變物體的高度。
                      </p>
                    </div>
                    <section className="lesson-panel">
                      <div className="lesson-plot-heading">
                        <h2>這個像素，三次各有多亮？</h2>
                        <span>
                          x = {probeX}，y = {probeY}
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
                              第 {k + 1} 張 · I{k + 1}
                            </span>
                            <b>{value.toFixed(3)}</b>
                          </div>
                        ))}
                      </div>
                      <p className="lesson-axis-description">
                        縱軸＝亮度（0 黑、1 白） · 橫軸＝影像從左到右的位置
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
                          換一個像素看看
                          <ArrowRight size={18} />
                        </button>
                        <span>三條線分別代表第 1、2、3 張照片。</span>
                      </div>
                    </section>
                    <div className="lesson-takeaway">
                      <strong>這一步要記住</strong>
                      <p>
                        不要只看一張照片的明暗。把同一個像素的三次亮度一起看，才有足夠資訊算出
                        Phase。
                      </p>
                    </div>
                  </>
                ) : step === 3 ? (
                  <>
                    <div className="lesson-instruction">
                      <strong>演算法正在做什麼？</strong>
                      <p>
                        把剛才同一像素的{" "}
                        <strong>
                          {values.map((v) => v.toFixed(3)).join("、")}
                        </strong>{" "}
                        輸入三步 Phase Shifting 解算，得到下面的角度。這不是從
                        Ground Truth 讀出的答案。
                      </p>
                    </div>
                    <section className="lesson-panel">
                      <div className="lesson-phase-result">
                        <div>
                          <span>目前像素的 Wrapped Phase</span>
                          <strong data-testid="guide-phase-value">
                            {Number.isFinite(phase) ? phase.toFixed(3) : "N/A"}
                            <small>
                              {Number.isFinite(phase) ? " rad" : ""}
                            </small>
                          </strong>
                        </div>
                        <p>
                          一個條紋週期是 360°，也就是 2π rad。這個角度表示
                          <strong>條紋週期內的位置</strong>
                          ；單頻率還不知道它是第幾條條紋。
                        </p>
                      </div>
                      <div className="lesson-plot-heading">
                        <h2>對每個像素重複解算</h2>
                        <span>橫軸仍是影像位置</span>
                      </div>
                      <div className="lesson-chart-legend">
                        <span style={{ color: COLORS[1] }}>
                          紫色：Wrapped Phase
                        </span>
                        {relative && (
                          <span style={{ color: COLORS[0] }}>
                            綠色：Relative Unwrapped Phase
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
                        紫線跳下去不是表面突然變高或變低，而是角度超出 +π
                        後，改用 −π 開始表示。
                      </p>
                      <button
                        className="lesson-secondary"
                        onClick={() => setRelative((v) => !v)}
                      >
                        {relative
                          ? "只看 Wrapped Phase"
                          : "把跳變接起來（1D Unwrap）"}
                        <ArrowRight size={18} />
                      </button>
                      {relative && (
                        <p className="lesson-unwrap-explanation">
                          接起來的是相對 Phase，還不能當作深度。
                        </p>
                      )}
                      <details className="lesson-formula">
                        <summary>想知道怎麼算？再展開公式</summary>
                        <p>
                          曝光順序為 0°、120°、240°，模型使用 cos(φ + δ)。atan2
                          以兩個輸入保留象限：
                        </p>
                        <code>φ̂ = atan2(√3(I₃ − I₂), 2I₁ − I₂ − I₃)</code>
                        <p>
                          解算只讀取三個量測亮度。1D Unwrap
                          只依相鄰相位差恢復連續區段，不補未知整數週期；它假設相鄰真實相位差的絕對值小於
                          π。
                        </p>
                      </details>
                    </section>
                    <div className="lesson-takeaway">
                      <strong>接下來，為什麼需要 Unwrapping？</strong>
                      <p>
                        你已從三張照片算出 Wrapped Phase。下一步會親手修正跨過
                        ±π
                        的相位差，並理解：把曲線接得連續，不代表已知道絕對條紋序號，更不等於完成
                        3D。
                      </p>
                      <p className="lesson-quality">
                        目前全部像素有效率：
                        {(result.metrics.validRatio * 100).toFixed(1)}
                        %。此數值不是 3D 準確度。
                      </p>
                    </div>
                  </>
                ) : (
                  <PhaseUnwrappingLesson
                    wrapped={result.phase.wrapped}
                    valid={result.phase.valid}
                    row={row}
                    width={config.width}
                    probeX={probeX}
                    onSelectX={onSelectX}
                  />
                )}
              </div>
              {step !== 4 && (
                <aside className="lesson-scene-panel" aria-label="3D 示意">
                  <h2>在 3D 空間裡是哪一步？</h2>
                  <Suspense
                    fallback={
                      <div className="lesson-scene">正在載入 3D 示意…</div>
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
                    aria-label="3D 示意顯示的曝光"
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
                        {autoplay ? "暫停輪播" : "自動輪播"}
                      </button>
                    )}
                  </div>
                  <p
                    className="lesson-scene-caption"
                    data-testid="lesson-scene-caption"
                  >
                    {step === 1
                      ? "Projector（黃）把條紋投到牆上，Camera（藍）從旁邊拍。三張照片之間只有條紋平移 120°，牆、Camera 都沒動。藍框就是 Camera 拍到的範圍，對應左邊的照片。"
                      : step === 2
                        ? "你選的像素 = Camera 發出的一條射線（藍線），打在牆上的紅點。三個亮度就是這個點在三次投影下的亮度。"
                        : step === 3
                          ? `φ̂ 只告訴我們紅點在「某一條條紋內」的位置：這個示意裡，Projector 有多張候選光平面（黃）。單一 Wrapped Phase 分不出是哪一張；這裡不使用真值替你挑答案。下一步先看 Spatial Unwrap 能補回什麼。此圖是理想平面示意，不是重建結果。`
                          : "Spatial Unwrap 把相鄰像素接成連續區段，但不知道起點的絕對條紋序號；候選光平面不會自動變成唯一。這裡不突出任何一張，不用真值替你選答案。還需要額外編碼或約束、Camera–Projector Calibration 與 Triangulation，才能得到 3D。此圖只作示意，不參與本頁計算。"}
                  </p>
                  <button className="lesson-secondary" onClick={onSandbox}>
                    到 3D 沙盒看真實掃描
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
                {step === 1 ? "回到介紹" : "上一步"}
              </button>
              {step < 4 ? (
                <button className="lesson-primary" onClick={next}>
                  {step === 1
                    ? "下一步：讀取一個像素"
                    : step === 2
                      ? "下一步：算出 Phase"
                      : "下一步：理解 Phase Unwrapping"}
                  <ArrowRight size={19} />
                </button>
              ) : (
                <button className="lesson-secondary" onClick={onExplore}>
                  自由實驗
                  <ArrowRight size={19} />
                </button>
              )}
            </footer>
          </>
        )}
        <footer className="learning-footer">
          <button onClick={onReadNotes}>
            <BookOpen size={18} />
            閱讀完整原理筆記
          </button>
          <span>理想化合成影像 · 沒有 3D 重建 · 參數與計算留在本機</span>
        </footer>
      </main>
    </div>
  );
}
