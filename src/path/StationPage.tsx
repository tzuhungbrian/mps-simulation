import { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleDashed,
  FlaskConical,
  ListChecks,
  ScanLine,
} from "lucide-react";
import PathNav, { ControlMark } from "./PathNav";
import {
  CHAPTERS,
  STATIONS,
  stationByN,
  type Activity,
  type Part,
  type Route,
  type Station,
} from "./stations";
import {
  checksPassed,
  pathProgress,
  stationState,
  usePathProgress,
} from "./progress";
import { INLINE_LABS, THEORY } from "./theory";
import "../calibration/calibration.css";
import "./path.css";

const PARTS: { id: Part; label: string; Icon: typeof BookOpen }[] = [
  { id: "theory", label: "理論", Icon: BookOpen },
  { id: "lab", label: "實驗", Icon: FlaskConical },
  { id: "check", label: "檢核", Icon: ListChecks },
];

function SourceTag() {
  return <span className="path-tag is-reference">參考值</span>;
}

function ActivityCard({
  activity,
  primary,
  station,
  onGo,
}: {
  activity: Activity;
  primary?: boolean;
  station: number;
  onGo: (r: Route) => void;
}) {
  return (
    <div className={`path-activity${primary ? " is-primary" : ""}`}>
      <div>
        <h3>{activity.label}</h3>
        <p>{activity.detail}</p>
      </div>
      <button
        className={primary ? "path-button-primary" : "path-button"}
        onClick={() => {
          pathProgress.markLab(station);
          onGo({
            kind: "tool",
            tool: activity.tool,
            station,
            step: activity.step,
          });
        }}
      >
        開啟
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function Inputs({ st }: { st: Station }) {
  if (!st.inputs.length)
    return (
      <p className="path-inputs-none">
        這一站不需要前面站的產出，可以直接開始。
      </p>
    );
  return (
    <div className="path-inputs">
      <h3>本站的輸入</h3>
      <ul>
        {st.inputs.map((i) => (
          <li key={i.label}>
            <b>{i.label}</b>
            <span>第 {i.from.join("–")} 站</span>
            <SourceTag />
          </li>
        ))}
      </ul>
      <p>目前一律使用參考值；你在前面站得到的結果，下一階段才會帶進來。</p>
    </div>
  );
}

export default function StationPage({
  n,
  part,
  onGo,
}: {
  n: number;
  part: Part;
  onGo: (r: Route) => void;
}) {
  const st = stationByN(n)!;
  const { progress } = usePathProgress();
  const sp = progress.stations[n] ?? {};
  const state = stationState(st, progress);
  const prev = stationByN(n - 1),
    next = stationByN(n + 1);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    pathProgress.visit(n, part);
    // Inline-only labs (e.g. station 8) are "opened" by viewing the tab.
    if (part === "lab" && st.inline && !st.primary) pathProgress.markLab(n);
  }, [n, part, st]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [n, part]);

  const setPart = (p: Part) => onGo({ kind: "station", n, part: p });
  const passed = checksPassed(st, progress);

  return (
    <div className="calib-shell path-shell">
      <header className="calib-header path-header">
        <button className="path-brand" onClick={() => onGo({ kind: "home" })}>
          <ScanLine size={22} aria-hidden="true" />
          Structured Light Lab
        </button>
        <PathNav onGo={onGo} />
      </header>

      <div className="path-station-head">
        <ControlMark n={n} state={state} current size={56} />
        <div className="path-station-title">
          <h1 ref={heading}>{st.title}</h1>
          <p>{st.summary}</p>
          <small>
            第 {n} / {STATIONS.length} 站 · {CHAPTERS[st.chapter]}
            {st.output && <> · 產出：{st.output}</>}
          </small>
        </div>
        <div className="path-station-step">
          <button
            className="path-button"
            disabled={!prev}
            onClick={() =>
              prev && onGo({ kind: "station", n: prev.n, part: "theory" })
            }
          >
            <ArrowLeft size={16} aria-hidden="true" />
            上一站
          </button>
          <button
            className="path-button"
            disabled={!next}
            onClick={() =>
              next && onGo({ kind: "station", n: next.n, part: "theory" })
            }
          >
            下一站
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="path-parts" role="tablist" aria-label="本站內容">
        {PARTS.map(({ id, label, Icon }) => {
          const done =
            id === "theory"
              ? sp.theory
              : id === "lab"
                ? sp.lab
                : st.checks.length > 0 && passed === st.checks.length;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={part === id}
              className={done ? "is-done" : ""}
              onClick={() => setPart(id)}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
              {id === "check" && st.checks.length > 0 && (
                <span className="path-count">
                  {passed}/{st.checks.length}
                </span>
              )}
              {done && <Check size={15} aria-label="已完成" />}
            </button>
          );
        })}
      </div>

      <main className="calib-article path-body" role="tabpanel">
        {part === "theory" && (
          <>
            {THEORY[n]}
            {!st.planned && (
              <div className="path-next">
                <button
                  className="path-button-primary"
                  onClick={() => {
                    pathProgress.markTheory(n);
                    setPart("lab");
                  }}
                >
                  讀完了，前往實驗
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}

        {part === "lab" &&
          (st.planned ? (
            <p className="path-planned">這一站還在規劃中，目前沒有實驗。</p>
          ) : (
            <>
              <Inputs st={st} />
              {st.primary && (
                <ActivityCard
                  activity={st.primary}
                  primary
                  station={n}
                  onGo={onGo}
                />
              )}
              {st.secondary.map((a) => (
                <ActivityCard
                  key={a.label}
                  activity={a}
                  station={n}
                  onGo={onGo}
                />
              ))}
              {st.inline?.map((id) => (
                <section key={id} className="path-inline-lab">
                  <h2>{INLINE_LABS[id].title}</h2>
                  {INLINE_LABS[id].body}
                </section>
              ))}
              <div className="path-next">
                <button
                  className={st.primary ? "path-button" : "path-button-primary"}
                  onClick={() => setPart("check")}
                >
                  前往檢核
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </>
          ))}

        {part === "check" &&
          (st.planned ? (
            <p className="path-planned">這一站還在規劃中，目前沒有檢核項目。</p>
          ) : (
            <>
              <div className="path-checks">
                <h2>通過條件</h2>
                <p>
                  這些是提示，不是關卡：沒有全部通過，也可以前往下一站。
                  {st.checks.some((c) => c.auto) &&
                    "標示「實驗室判定」的項目由 3D 實驗室自動勾選，達成一次就會保留。"}
                </p>
                <ul>
                  {st.checks.map((c) => {
                    const ok = !!sp.checks?.[c.id];
                    return (
                      <li key={c.id} className={ok ? "is-ok" : ""}>
                        {c.auto ? (
                          <>
                            {ok ? (
                              <Check size={18} aria-label="已達成" />
                            ) : (
                              <CircleDashed size={18} aria-label="尚未達成" />
                            )}
                            <span>{c.text}</span>
                            <small>實驗室判定</small>
                          </>
                        ) : (
                          <label>
                            <input
                              type="checkbox"
                              checked={ok}
                              onChange={(e) =>
                                pathProgress.setCheck(n, c.id, e.target.checked)
                              }
                            />
                            <span>{c.text}</span>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="path-checks-summary" role="status">
                  {passed === st.checks.length
                    ? "這一站全部通過。"
                    : `已通過 ${passed} / ${st.checks.length} 項。`}
                </p>
              </div>
              <div className="path-next">
                {next ? (
                  <button
                    className="path-button-primary"
                    onClick={() =>
                      onGo({ kind: "station", n: next.n, part: "theory" })
                    }
                  >
                    前往第 {next.n} 站：{next.title}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    className="path-button-primary"
                    onClick={() => onGo({ kind: "home" })}
                  >
                    回到學習路徑
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            </>
          ))}
      </main>
    </div>
  );
}
