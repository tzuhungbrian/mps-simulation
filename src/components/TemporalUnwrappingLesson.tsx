import { useMemo, useState } from "react";
import { TAU } from "../core/simulation";
import { t } from "../i18n";
import {
  FINE,
  HIERARCHY,
  LEVELS_ALL,
  LEVELS_SKIP,
  MAX_STEP_CYCLES,
  PROJECTOR_WIDTH,
  explainPixel,
  orderErrors,
  spatialAligned,
  synthesizeScene,
  toProjectorPixel,
  unwrapTemporal,
} from "../lib/temporalLesson";
import LineChart from "./LineChart";
import "./PhaseUnwrappingLesson.css";

interface Props {
  width: number;
  probeX: number;
  onSelectX: (fraction: number) => void;
  stepCycles: number;
  onStepCycles: (cycles: number) => void;
}
const LEVEL_COLORS = ["#edbd79", "#69d9ff", "#b7a0fa"],
  GREEN = "#5ee4bd",
  AMBER = "#edbd79",
  TRUTH = "#93a4b8";
/** Rows pooled for the error rates; charts show the first one. */
const ROWS = 32;
const rad = (v: number | null | undefined) =>
  v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(3) : "—";
const pct = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(n && n / d < 0.001 ? 3 : 1)}%` : "—";

export default function TemporalUnwrappingLesson({
  width,
  probeX,
  onSelectX,
  stepCycles,
  onStepCycles,
}: Props) {
  const [noise, setNoise] = useState(0.02);
  const scene = useMemo(
    () =>
      synthesizeScene({
        width,
        rows: ROWS,
        stepCycles,
        noiseSigma: noise,
      }),
    [width, stepCycles, noise],
  );
  const full = useMemo(() => unwrapTemporal(scene, LEVELS_ALL), [scene]);
  const skip = useMemo(() => unwrapTemporal(scene, LEVELS_SKIP), [scene]);
  const fullStats = useMemo(() => orderErrors(scene, full), [scene, full]);
  const skipStats = useMemo(() => orderErrors(scene, skip), [scene, skip]);
  const truth = useMemo(
    () => scene.truth!.subarray(0, width).map((u) => TAU * FINE * u),
    [scene, width],
  );
  // The step comparison stays noise-free so it isolates the step itself.
  const clean = useMemo(
    () => synthesizeScene({ width, stepCycles }),
    [width, stepCycles],
  );
  const cleanSpatial = useMemo(() => spatialAligned(clean), [clean]);
  const cleanTemporal = useMemo(
    () => unwrapTemporal(clean, LEVELS_ALL),
    [clean],
  );
  const cleanTruth = useMemo(
    () => clean.truth!.map((u) => TAU * FINE * u),
    [clean],
  );
  const slipOf = (a: ArrayLike<number>) =>
    Float64Array.from({ length: width }, (_, i) => (a[i] - truth[i]) / TAU);
  const steps = explainPixel(
    LEVELS_ALL.map((l) => scene.wrapped[l][probeX]),
    HIERARCHY,
  );
  const absolute = steps ? steps[steps.length - 1].absolute : NaN;
  const spatialSlip =
    Math.round((cleanSpatial[width - 1] - cleanTruth[width - 1]) / TAU) || 0;
  let rowErrors = 0;
  for (let i = 0; i < width; i++)
    if (Math.abs(cleanTemporal[i] - cleanTruth[i]) > Math.PI) rowErrors++;
  const selected = probeX / (width - 1);
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    String(Math.round(t * (width - 1))),
  );
  const fineLabels = [1, 0.75, 0.5, 0.25, 0].map((t) =>
    (t * TAU * FINE).toFixed(0),
  );
  const ratio = (levels: number[]) =>
    Math.max(
      ...levels.slice(1).map((l, i) => HIERARCHY[l] / HIERARCHY[levels[i]]),
    );
  return (
    <div className="unwrap-lesson">
      <div className="lesson-instruction">
        <strong>
          {t(
            "同一個像素，多拍幾組頻率",
            "Same pixel, several fringe frequencies",
          )}
        </strong>
        <p className="unwrap-intro">
          {t(
            <>
              Spatial 借用鄰居；Temporal
              只看同一個像素。最粗的條紋在整個量測範圍只有 {HIERARCHY[0]}{" "}
              個週期，它的相位沒有歧義，可以當成粗略位置；再一層一層換到更密的條紋，每一層只需要決定「第幾圈」。
            </>,
            <>
              Spatial borrows from neighbors; Temporal looks only at the same
              pixel. The coarsest fringes have just {HIERARCHY[0]}{" "}
              {HIERARCHY[0] === 1 ? "period" : "periods"} across the whole
              measuring range, so their phase is unambiguous and gives a rough
              position. Then you step to denser and denser fringes, and at each
              level you only need to decide "which cycle".
            </>,
          )}
        </p>
      </div>

      <fieldset className="temporal-source">
        <legend>{t("資料來源", "Data source")}</legend>
        <label>
          <input type="radio" name="temporal-source" defaultChecked />
          {t(
            `1D 合成條紋（三步相移 × ${HIERARCHY.length} 組頻率）`,
            `1D synthetic fringes (three-step phase shift × ${HIERARCHY.length} frequencies)`,
          )}
        </label>
        <label className="is-disabled">
          <input type="radio" name="temporal-source" disabled />
          {t(
            "3D 實驗室拍到的影像（之後開放）",
            "Images captured in the 3D lab (coming later)",
          )}
        </label>
      </fieldset>

      <section
        className="lesson-panel unwrap-panel"
        aria-label={t(
          "逐層決定條紋級次",
          "Decide the fringe order level by level",
        )}
      >
        <div className="lesson-plot-heading">
          <h2>
            {t(
              "1. 三組頻率，逐層決定第幾圈",
              "1. Three frequencies, deciding the cycle level by level",
            )}
          </h2>
          <span>
            {t(
              `頻率 ${HIERARCHY.join("、")}，和 3D 實驗室相同`,
              `Frequencies ${HIERARCHY.join(", ")}, same as the 3D lab`,
            )}
          </span>
        </div>
        <p>
          {t(
            <>
              每一組頻率都用前面學的三步相移解出 Wrapped
              Phase。選一個像素，看它怎麼從最粗的一層，一路換算到最細的一層。
            </>,
            <>
              Each frequency is decoded to a wrapped phase with the three-step
              phase shift you learned earlier. Pick a pixel and follow it from
              the coarsest level all the way to the finest.
            </>,
          )}
        </p>
        <div className="unwrap-workbench">
          <div className="unwrap-plot">
            <div className="lesson-chart-legend">
              {HIERARCHY.map((f, l) => (
                <span key={f} style={{ color: LEVEL_COLORS[l] }}>
                  f = {f}
                  {l === 0
                    ? t("（最粗）", " (coarsest)")
                    : l === HIERARCHY.length - 1
                      ? t("（最細）", " (finest)")
                      : ""}
                </span>
              ))}
            </div>
            <p className="lesson-axis-description">
              {t(
                "縱軸＝Wrapped Phase（rad） · 橫軸＝影像像素 x · 點擊、拖曳或用方向鍵選像素",
                "Vertical axis = wrapped phase (rad) · Horizontal axis = image pixel x · Click, drag or use the arrow keys to pick a pixel",
              )}
            </p>
            <LineChart
              series={HIERARCHY.map((f, l) => ({
                values: scene.wrapped[l].subarray(0, width),
                color: LEVEL_COLORS[l],
                label: `Wrapped f=${f}`,
              }))}
              min={-Math.PI - 0.2}
              max={Math.PI + 0.2}
              selected={selected}
              onSelect={onSelectX}
              xLabels={xLabels}
              testId="temporal-wrapped-chart"
            />
          </div>
          <div
            className="unwrap-inspector"
            aria-label={t(
              "所選像素的逐層計算",
              "Level-by-level calculation for the selected pixel",
            )}
          >
            <p className="temporal-pixel">x = {probeX}</p>
            {steps ? (
              <table className="temporal-table" data-testid="temporal-table">
                <thead>
                  <tr>
                    <th>f</th>
                    <th>φ</th>
                    <th>r·Φ</th>
                    <th>k</th>
                    <th>Φ</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, l) => (
                    <tr key={s.frequency}>
                      <td style={{ color: LEVEL_COLORS[l] }}>{s.frequency}</td>
                      <td>{rad(s.wrapped)}</td>
                      <td>{s.predicted === null ? "—" : rad(s.predicted)}</td>
                      <td data-testid={`temporal-k-${s.frequency}`}>
                        {s.order}
                      </td>
                      <td>{rad(s.absolute)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="unwrap-transition">
                {t(
                  "這個像素有一層無效（太暗或飽和），不補值。",
                  "One level of this pixel is invalid (too dark or saturated), so it's left unfilled.",
                )}
              </p>
            )}
            <div className="unwrap-equation">
              <span>
                {t(
                  "k = round((r·Φ上一層 − φ) / 2π)",
                  "k = round((r·Φ_prev − φ) / 2π)",
                )}
              </span>
              <span>Φ = φ + 2πk</span>
            </div>
          </div>
        </div>
        <p className="lesson-caption">
          {t(
            <>
              r 是和上一層的頻率比（這裡都是 4）。最粗那層只有一個週期，直接把 φ
              換到 0 到 2π 就是絕對相位。和 3D 實驗室的{" "}
              <code>unwrapTemporal</code> 是同一條規則。
            </>,
            <>
              r is the frequency ratio to the previous level (4 everywhere
              here). The coarsest level has only one period, so mapping φ to 0
              to 2π gives the absolute phase directly. This is the same rule as{" "}
              <code>unwrapTemporal</code> in the 3D lab.
            </>,
          )}
        </p>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label={t(
          "Temporal 與 Spatial 在斷層上的比較",
          "Temporal vs. Spatial at a depth step",
        )}
      >
        <div className="lesson-plot-heading">
          <h2>{t("2. 斷層也不怕", "2. Depth steps are no problem")}</h2>
        </div>
        <p>
          {t(
            <>
              第 4 步的斷層搬到這裡（不加雜訊，只看斷層的影響）。Temporal
              逐像素決定 k，不需要鄰居連續。
            </>,
            <>
              Here is the depth step from step 4 (no noise, so you see only the
              effect of the step). Temporal decides k pixel by pixel and doesn't
              need continuous neighbors.
            </>,
          )}
        </p>
        <label className="unwrap-slider">
          <span>
            {t(
              <>
                斷層高度：
                <b data-testid="temporal-step-cycles">
                  {stepCycles.toFixed(2)}
                </b>{" "}
                圈
              </>,
              <>
                Depth step:{" "}
                <b data-testid="temporal-step-cycles">
                  {stepCycles.toFixed(2)}
                </b>{" "}
                cycles
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
            {t("綠色：Temporal 結果", "Green: Temporal result")}
          </span>
          <span style={{ color: AMBER }}>
            {t("橘色：Spatial 結果", "Orange: Spatial result")}
          </span>
          <span style={{ color: TRUTH }}>
            {t("灰色虛線：合成真值", "Gray dashed: synthetic ground truth")}
          </span>
        </div>
        <LineChart
          compact
          series={[
            {
              values: cleanTruth,
              color: TRUTH,
              label: t("合成真值", "Synthetic ground truth"),
              dashed: true,
            },
            { values: cleanSpatial, color: AMBER, label: "Spatial" },
            { values: cleanTemporal, color: GREEN, label: "Temporal" },
          ]}
          min={0}
          max={TAU * FINE}
          yLabels={fineLabels}
          xLabels={xLabels}
          testId="temporal-step-chart"
        />
        <div className="temporal-compare">
          <div>
            <span>{t("Spatial：斷層後", "Spatial: after the step")}</span>
            <b data-testid="temporal-spatial-slip">
              {spatialSlip
                ? t(
                    `差 ${-spatialSlip} 圈`,
                    `Off by ${-spatialSlip} ${spatialSlip === -1 ? "cycle" : "cycles"}`,
                  )
                : t("沒有接錯", "No error")}
            </b>
          </div>
          <div>
            <span>
              {t(
                "Temporal：這一列級次錯誤",
                "Temporal: fringe-order errors in this row",
              )}
            </span>
            <b data-testid="temporal-row-errors">
              {t(
                `${rowErrors} 個像素`,
                `${rowErrors} ${rowErrors === 1 ? "pixel" : "pixels"}`,
              )}
            </b>
          </div>
        </div>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label={t("雜訊與頻率比", "Noise and frequency ratio")}
      >
        <div className="lesson-plot-heading">
          <h2>
            {t(
              "3. 雜訊會被頻率比放大",
              "3. The frequency ratio amplifies noise",
            )}
          </h2>
        </div>
        <p>
          {t(
            <>
              粗一層的相位誤差 ε，乘上頻率比 r 之後才拿來猜下一層的 k。只要{" "}
              <strong>|r·ε| ≥ π</strong>，k 就會猜錯一整圈。所以 r
              越大，容許的雜訊越小。試著把雜訊調大，比較兩種頻率組合。
            </>,
            <>
              The coarser level's phase error ε is multiplied by the frequency
              ratio r before it's used to guess the next level's k. As soon as{" "}
              <strong>|r·ε| ≥ π</strong>, k is off by a whole cycle. So the
              larger r is, the less noise you can tolerate. Try raising the
              noise and compare the two frequency sets.
            </>,
          )}
        </p>
        <label className="unwrap-slider">
          <span>
            {t("影像雜訊 σ：", "Image noise σ: ")}
            <b data-testid="temporal-noise">{noise.toFixed(3)}</b>
            <small>
              {t(
                <>
                  （亮度 0–1；粗一層的實際相位誤差 ε_rms ≈{" "}
                  {rad(fullStats.coarseNoise)} rad）
                </>,
                <>
                  {" "}
                  (intensity 0–1; actual phase error of the coarser level ε_rms
                  ≈ {rad(fullStats.coarseNoise)} rad)
                </>,
              )}
            </small>
          </span>
          <input
            type="range"
            min={0}
            max={0.08}
            step={0.005}
            value={noise}
            onChange={(e) => setNoise(Number(e.target.value))}
          />
        </label>
        <div className="temporal-compare">
          {[
            { levels: LEVELS_ALL, stats: fullStats, id: "full" },
            { levels: LEVELS_SKIP, stats: skipStats, id: "skip" },
          ].map(({ levels, stats, id }) => {
            const r = ratio(levels);
            return (
              <div key={id} data-testid={`temporal-${id}`}>
                <span>
                  {"{"}
                  {levels.map((l) => HIERARCHY[l]).join(", ")}
                  {"}"} · {t("最大", "max")} r = {r} · {t("容許", "tolerates")}{" "}
                  |ε| &lt; {rad(Math.PI / r)} rad
                </span>
                <b data-testid={`temporal-${id}-rate`}>
                  {pct(stats.errors, stats.valid)}
                </b>
                <small>
                  {t(
                    `級次錯誤 ${stats.errors} / ${stats.valid} 像素（${ROWS} 列）`,
                    `Fringe-order errors: ${stats.errors} / ${stats.valid} pixels (${ROWS} rows)`,
                  )}
                </small>
              </div>
            );
          })}
        </div>
        <div className="lesson-chart-legend">
          <span style={{ color: GREEN }}>
            {t("綠色：", "Green: ")}
            {"{"}
            {HIERARCHY.join(", ")}
            {"}"}
            {t(" 的誤差", " error")}
          </span>
          <span style={{ color: AMBER }}>
            {t("橘色：", "Orange: ")}
            {"{"}
            {LEVELS_SKIP.map((l) => HIERARCHY[l]).join(", ")}
            {"}"}
            {t(" 的誤差", " error")}
          </span>
        </div>
        <p className="lesson-axis-description">
          {t(
            "縱軸＝結果減真值（圈）· 跳到 ±1 的地方就是猜錯一圈",
            "Vertical axis = result minus truth (cycles) · Wherever it jumps to ±1, k was off by one cycle",
          )}
        </p>
        <LineChart
          compact
          series={[
            { values: slipOf(skip), color: AMBER, label: "skip" },
            { values: slipOf(full), color: GREEN, label: "full" },
          ]}
          min={-2}
          max={2}
          yLabels={["+2", "+1", "0", "−1", "−2"]}
          xLabels={xLabels}
          testId="temporal-noise-chart"
        />
        <p className="lesson-caption">
          {t(
            <>
              這就是 3D 實驗室分三層的原因：每層 r = 4，容許的誤差是直接跳到 16
              的 4 倍；代價是多拍一組條紋。
            </>,
            <>
              That's why the 3D lab uses three levels: with r = 4 per level, the
              tolerated error is 4 times that of jumping straight to 16; the
              cost is one more set of fringes.
            </>,
          )}
        </p>
      </section>

      <section
        className="lesson-panel unwrap-panel"
        aria-label={t(
          "絕對相位換成 Projector 像素",
          "Convert absolute phase to projector pixels",
        )}
      >
        <div className="lesson-plot-heading">
          <h2>
            {t(
              "4. 交給下一站：換成 Projector 像素",
              "4. Hand-off to the next station: projector pixels",
            )}
          </h2>
        </div>
        <p>
          {t(
            <>
              絕對相位沒有未知的 2πk，可以直接換成「這個 Camera 像素看到的是
              Projector 的第幾行」。最細一層有 {FINE} 個週期、Projector 寬{" "}
              {PROJECTOR_WIDTH} px：
            </>,
            <>
              Absolute phase has no unknown 2πk, so it converts directly to
              "which projector column this camera pixel sees". The finest level
              has {FINE} periods and the projector is {PROJECTOR_WIDTH} px wide:
            </>,
          )}
        </p>
        <div
          className="unwrap-equation"
          data-testid="temporal-projector"
          data-value={
            Number.isFinite(absolute) ? toProjectorPixel(absolute) : undefined
          }
        >
          <span>
            u_p = Φ · W_p / (2π · f) = Φ · {PROJECTOR_WIDTH} / (2π · {FINE})
          </span>
          <p>
            x = {probeX}
            {t("：", ": ")}
            {rad(absolute)} rad →{" "}
            <strong style={{ color: GREEN }}>
              {Number.isFinite(absolute)
                ? `${toProjectorPixel(absolute).toFixed(1)} px`
                : "—"}
            </strong>
          </p>
        </div>
        <p>
          {t(
            <>
              第 5 站 Projector Calibration 就是用這個對應，把 Projector
              當成「反向的相機」來校正。實際掃描還要再投一組水平條紋，得到 v_p。
            </>,
            <>
              Station 5, Projector Calibration, uses exactly this mapping to
              calibrate the projector as an "inverse camera". A real scan also
              projects a set of horizontal fringes to get v_p.
            </>,
          )}
        </p>
      </section>

      <div className="lesson-takeaway">
        <strong>{t("這一步要記住", "Key takeaways")}</strong>
        <p>
          {t(
            <>
              <b>Temporal Unwrapping</b>{" "}
              每個像素自己決定第幾圈，得到絕對相位，斷層和缺口都不影響鄰居。
            </>,
            <>
              With <b>Temporal Unwrapping</b>, each pixel finds its own cycle
              and you get absolute phase; depth steps and gaps don't affect the
              neighbors.
            </>,
          )}
        </p>
        <p>
          {t(
            <>
              條件是 |r·ε| &lt; π：頻率比越大，越怕雜訊。分層可以把每一層的 r
              壓小，代價是多拍幾張。
            </>,
            <>
              The condition is |r·ε| &lt; π: the larger the frequency ratio, the
              more sensitive to noise. Splitting into levels keeps each r small,
              at the cost of a few more images.
            </>,
          )}
        </p>
      </div>
    </div>
  );
}
