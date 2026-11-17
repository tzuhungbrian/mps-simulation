import {
  ArrowRight,
  BookOpen,
  Check,
  CircleDashed,
  FlaskConical,
  ListChecks,
  ScanLine,
} from "lucide-react";
import { t } from "../i18n";
import PathNav, { ControlMark } from "./PathNav";
import {
  CHAPTERS,
  STATIONS,
  WORKBENCH,
  stationByN,
  type Part,
  type Route,
} from "./stations";
import {
  checksPassed,
  pathProgress,
  stationState,
  usePathProgress,
  type PathProgress,
} from "./progress";
import "./path.css";

// Orienteering course: straight legs between numbered controls, in % of the map box.
const COURSE: Record<number, [number, number]> = {
  1: [6, 26],
  2: [27, 26],
  3: [48, 26],
  4: [69, 26],
  5: [80, 48],
  6: [69, 70],
  7: [48, 70],
  8: [27, 70],
  9: [6, 70],
};

const ARTIFACTS: { label: string; from: string }[] = [
  {
    label: t("Camera 內參 K_c 與畸變", "Camera intrinsics K_c and distortion"),
    from: t("第 2 站", "Station 2"),
  },
  {
    label: t("絕對相位", "Absolute phase"),
    from: t("第 3–4 站", "Stations 3–4"),
  },
  {
    label: t(
      "Projector 內參 K_p 與 R | t",
      "Projector intrinsics K_p and R | t",
    ),
    from: t("第 5 站", "Station 5"),
  },
  {
    label: t("單套裝置的點雲", "Point cloud from a single rig"),
    from: t("第 6 站", "Station 6"),
  },
  {
    label: t("各裝置的世界座標轉換", "World transform of each device"),
    from: t("第 8 站", "Station 8"),
  },
  {
    label: t("融合後的高度圖", "Fused height map"),
    from: t("第 9 站", "Station 9"),
  },
];

const CONTINUE_LABEL: Record<Part, string> = {
  theory: t("繼續讀理論", "Keep reading the theory"),
  lab: t("回到實驗", "Back to the lab"),
  check: t("回到檢核", "Back to the check"),
};

function resumeTarget(p: PathProgress) {
  const cur = p.current ? stationByN(p.current) : undefined;
  if (!cur) return null;
  if (stationState(cur, p) !== "done")
    return { st: cur, part: p.part, advanced: false };
  const after = STATIONS.find(
    (s) => s.n > cur.n && !s.planned && stationState(s, p) !== "done",
  );
  return after
    ? { st: after, part: "theory" as Part, advanced: true }
    : { st: cur, part: p.part, advanced: false };
}

export default function PathHome({ onGo }: { onGo: (r: Route) => void }) {
  const { progress, persistent } = usePathProgress();
  const target = resumeTarget(progress);
  const st = target?.st ?? STATIONS[0];
  const sp = progress.stations[st.n] ?? {};
  const passed = checksPassed(st, progress);
  const legs = STATIONS.slice(0, -1).map((s) => {
    const next = STATIONS[s.n];
    const nextPlanned = next.planned || s.planned;
    return {
      key: s.n,
      from: COURSE[s.n],
      to: COURSE[next.n],
      cls:
        stationState(s, progress) === "done"
          ? "is-done"
          : nextPlanned
            ? "is-planned"
            : "",
    };
  });

  return (
    <div className="path-shell path-home">
      <header className="calib-header path-header">
        <button className="path-brand" onClick={() => onGo({ kind: "home" })}>
          <ScanLine size={22} aria-hidden="true" />
          Structured Light Lab
        </button>
        <p className="path-crumb">
          {t("學習路徑", "Learning path")}
          {target && (
            <>
              <span aria-hidden="true">›</span>
              <b>
                {t(
                  `第 ${st.n} / ${STATIONS.length} 站 · ${st.title}`,
                  `Station ${st.n} / ${STATIONS.length} · ${st.title}`,
                )}
              </b>
            </>
          )}
        </p>
        <PathNav onGo={onGo} showHome={false} />
      </header>

      <main className="path-home-main">
        <section className="path-resume" aria-labelledby="resume-title">
          <ControlMark
            n={st.n}
            state={stationState(st, progress)}
            current
            size={64}
          />
          <div className="path-resume-text">
            {target ? (
              <>
                <h1 id="resume-title">
                  {target.advanced
                    ? t(`下一站：${st.title}`, `Next: ${st.title}`)
                    : t(`繼續：${st.title}`, `Continue: ${st.title}`)}
                </h1>
                <p>{st.summary}</p>
                <ul
                  className="path-resume-parts"
                  aria-label={t("本站狀態", "This station's status")}
                >
                  <li
                    className={
                      sp.theory
                        ? "is-done"
                        : target.part === "theory"
                          ? "is-current"
                          : ""
                    }
                  >
                    {sp.theory ? (
                      <Check size={15} aria-hidden="true" />
                    ) : (
                      <BookOpen size={15} aria-hidden="true" />
                    )}
                    {t("理論", "Theory")}
                  </li>
                  <li
                    className={
                      sp.lab
                        ? "is-done"
                        : target.part === "lab"
                          ? "is-current"
                          : ""
                    }
                  >
                    {sp.lab ? (
                      <Check size={15} aria-hidden="true" />
                    ) : (
                      <FlaskConical size={15} aria-hidden="true" />
                    )}
                    {t("實驗", "Lab")}
                  </li>
                  <li
                    className={
                      target.part === "check"
                        ? "is-current"
                        : passed === st.checks.length && passed
                          ? "is-done"
                          : ""
                    }
                  >
                    <ListChecks size={15} aria-hidden="true" />
                    {t("檢核", "Check")}{" "}
                    {st.checks.length ? `${passed}/${st.checks.length}` : ""}
                  </li>
                </ul>
              </>
            ) : (
              <>
                <h1 id="resume-title">
                  {t(
                    `從第 1 站開始：${st.title}`,
                    `Start with Station 1: ${st.title}`,
                  )}
                </h1>
                <p>
                  {t(
                    <>
                      九站依實際架設的順序排列：先認識相機模型與 Camera
                      校正，再學相位與 Projector 校正，最後重建出點雲、做多視角
                      Fusion。任何一站都可以直接進入。
                    </>,
                    <>
                      The nine stations follow the order of a real setup: first
                      the camera model and camera calibration, then phase and
                      projector calibration, and finally point-cloud
                      reconstruction and multi-view fusion. You can jump into
                      any station directly.
                    </>,
                  )}
                </p>
              </>
            )}
          </div>
          <button
            className="path-button-primary path-resume-go"
            onClick={() =>
              onGo({ kind: "station", n: st.n, part: target?.part ?? "theory" })
            }
          >
            {target
              ? target.advanced
                ? t(`開始第 ${st.n} 站`, `Start Station ${st.n}`)
                : CONTINUE_LABEL[target.part]
              : t("開始第 1 站", "Start Station 1")}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </section>

        <section className="path-course" aria-labelledby="course-title">
          <h2 id="course-title">{t("九站路線", "The nine-station course")}</h2>
          <p className="path-course-note">
            {t(
              "依實作順序排列；點任一站直接進入，通過條件只做提示。",
              "Ordered the way you'd build it; click any station to jump in. Pass criteria are only hints.",
            )}
          </p>
          <div className="path-map">
            <svg
              className="path-legs"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {legs.map((l) => (
                <line
                  key={l.key}
                  x1={l.from[0]}
                  y1={l.from[1]}
                  x2={l.to[0]}
                  y2={l.to[1]}
                  className={l.cls}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <ol className="path-stops">
              {STATIONS.map((s) => {
                const state = stationState(s, progress);
                const [x, y] = COURSE[s.n];
                const isCurrent = s.n === st.n && !!target;
                const status =
                  state === "planned"
                    ? t("規劃中", "Planned")
                    : state === "done"
                      ? t("已通過", "Passed")
                      : state === "partial"
                        ? t(
                            `進行中 · 檢核 ${checksPassed(s, progress)}/${s.checks.length}`,
                            `In progress · Check ${checksPassed(s, progress)}/${s.checks.length}`,
                          )
                        : t("未開始", "Not started");
                return (
                  <li
                    key={s.n}
                    style={{ left: `${x}%`, top: `${y}%` }}
                    className={`${s.n === 5 ? "is-turn " : s.n < 5 ? "is-top " : ""}${state === "planned" ? "is-planned" : ""}`}
                  >
                    <button
                      onClick={() =>
                        onGo({ kind: "station", n: s.n, part: "theory" })
                      }
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      <ControlMark
                        n={s.n}
                        state={state}
                        current={isCurrent}
                        size={36}
                      />
                      <span className="path-stop-label">
                        <b>{s.title}</b>
                        <small>{status}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="path-chapters">
            {CHAPTERS.map((c, i) => {
              const ns = STATIONS.filter((s) => s.chapter === i).map(
                (s) => s.n,
              );
              return (
                <span key={c}>
                  {ns[0]}–{ns[ns.length - 1]} {c}
                </span>
              );
            })}
          </p>
          <ul className="path-legend" aria-label={t("圖例", "Legend")}>
            <li>
              <ControlMark state="done" size={14} /> {t("已通過", "Passed")}
            </li>
            <li>
              <ControlMark state="partial" size={14} />{" "}
              {t("進行中", "In progress")}
            </li>
            <li>
              <ControlMark state="none" size={14} />{" "}
              {t("未開始", "Not started")}
            </li>
            <li>
              <ControlMark state="partial" current size={14} />{" "}
              {t("目前這一站", "Current station")}
            </li>
            <li>
              <ControlMark state="planned" size={14} /> {t("規劃中", "Planned")}
            </li>
          </ul>
        </section>

        <aside className="path-artifacts" aria-labelledby="artifacts-title">
          <h2 id="artifacts-title">
            {t("我的專案產出", "My project outputs")}
          </h2>
          <p>
            {t(
              "目前各站使用參考值；你在實驗中得到的結果，下一階段才會帶到下一站。",
              "For now every station uses reference values; the results you get in the labs will carry over to the next station in a later release.",
            )}
          </p>
          <ul>
            {ARTIFACTS.map((a) => (
              <li key={a.label}>
                <b>{a.label}</b>
                <span className="path-tag is-reference">
                  {t("參考值", "Reference value")}
                </span>
                <small>{t(`${a.from}產出`, `From ${a.from}`)}</small>
              </li>
            ))}
          </ul>
          {!persistent && (
            <p className="path-warn" role="alert">
              {t(
                "瀏覽器儲存空間不可用：進度只保留到關閉分頁為止。",
                "Browser storage is unavailable: your progress is kept only until you close this tab.",
              )}
            </p>
          )}
          {progress.current !== null && (
            <button
              className="path-text-button"
              onClick={() => {
                if (
                  confirm(
                    t(
                      "清除九站的閱讀、實驗與檢核紀錄？實驗參數不受影響。",
                      "Clear your reading, lab and check records for all nine stations? Lab parameters are not affected.",
                    ),
                  )
                )
                  pathProgress.reset();
              }}
            >
              <CircleDashed size={14} aria-hidden="true" />
              {t("重設進度", "Reset progress")}
            </button>
          )}
        </aside>

        <nav className="path-workbench" aria-label={t("工作台", "Workbench")}>
          <h2>{t("工作台", "Workbench")}</h2>
          <p>
            {t(
              "自由使用，不計入進度。",
              "Use these freely; they don't count toward progress.",
            )}
          </p>
          <div>
            {WORKBENCH.map((w) => (
              <button
                key={w.tool}
                className="path-button"
                onClick={() => onGo({ kind: "tool", tool: w.tool })}
              >
                {w.label}
              </button>
            ))}
          </div>
        </nav>
      </main>
    </div>
  );
}
