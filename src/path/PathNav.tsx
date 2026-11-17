import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Languages,
  Route as RouteIcon,
  Search,
} from "lucide-react";
import { lang, setLang, t } from "../i18n";
import { STATIONS, WORKBENCH, stationByN, type Route } from "./stations";
import { stationState, usePathProgress, type StationState } from "./progress";
import "./path.css";

export function ControlMark({
  n,
  state,
  current = false,
  size = 28,
}: {
  n?: number;
  state: StationState;
  current?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`path-control is-${state}${current ? " is-current" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

type Item = {
  key: string;
  label: string;
  detail: string;
  route: Route;
  n?: number;
};

function StationSwitcher({
  open,
  onClose,
  onGo,
}: {
  open: boolean;
  onClose: () => void;
  onGo: (r: Route) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { progress } = usePathProgress();
  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      {
        key: "home",
        label: t("學習路徑", "Learning path"),
        detail: t(
          "首頁：目前進度與九站路線",
          "Home: your progress and the nine stations",
        ),
        route: { kind: "home" },
      },
      ...STATIONS.map((s) => ({
        key: `s${s.n}`,
        n: s.n,
        label: t(`第 ${s.n} 站 · ${s.title}`, `Station ${s.n} · ${s.title}`),
        detail: s.planned ? t("規劃中", "Planned") : s.summary,
        route: { kind: "station", n: s.n, part: "theory" } as Route,
      })),
      ...WORKBENCH.map((w) => ({
        key: `w-${w.tool}`,
        label: t(`工作台 · ${w.label}`, `Workbench · ${w.label}`),
        detail: w.detail,
        route: { kind: "tool", tool: w.tool } as Route,
      })),
    ];
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((i) => `${i.label} ${i.detail}`.toLowerCase().includes(q))
      : all;
  }, [query]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery("");
      setActive(0);
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    onGo(item.route);
  };

  return (
    <dialog
      ref={dialog}
      className="path-switcher"
      aria-label={t("跳到站點或工作台", "Jump to a station or tool")}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="path-switcher-field">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          value={query}
          placeholder={t(
            "輸入站名或工具，例如「Projector」",
            'Type a station or tool, e.g. "Projector"',
          )}
          role="combobox"
          aria-expanded="true"
          aria-controls="path-switcher-list"
          aria-activedescendant={
            items[active] ? `path-opt-${items[active].key}` : undefined
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(items[active]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <ul
        id="path-switcher-list"
        role="listbox"
        aria-label={t("結果", "Results")}
      >
        {items.map((item, i) => {
          const st = item.n ? stationByN(item.n) : undefined;
          return (
            <li
              key={item.key}
              id={`path-opt-${item.key}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
            >
              {st ? (
                <ControlMark
                  n={st.n}
                  state={stationState(st, progress)}
                  size={24}
                />
              ) : (
                <span className="path-switcher-dot" aria-hidden="true" />
              )}
              <span>
                <b>{item.label}</b>
                <small>{item.detail}</small>
              </span>
            </li>
          );
        })}
        {!items.length && (
          <li className="path-switcher-empty">
            {t(
              `沒有符合「${query}」的站點或工具。`,
              `No station or tool matches "${query}".`,
            )}
          </li>
        )}
      </ul>
    </dialog>
  );
}

function WorkbenchMenu({ onGo }: { onGo: (r: Route) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details className="path-menu" ref={ref}>
      <summary>
        {t("工作台", "Workbench")}
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="path-menu-list">
        <p>
          {t(
            "自由使用的工具，不計入進度。",
            "Free-use tools; not counted as progress.",
          )}
        </p>
        {WORKBENCH.map((w) => (
          <button
            key={w.tool}
            onClick={() => {
              if (ref.current) ref.current.open = false;
              onGo({ kind: "tool", tool: w.tool });
            }}
          >
            <b>{w.label}</b>
            <small>{w.detail}</small>
          </button>
        ))}
      </div>
    </details>
  );
}

/** Shared navigation cluster: learning path, current station, switcher, workbench. */
export default function PathNav({
  station,
  onGo,
  showHome = true,
  compact = false,
}: {
  station?: number;
  onGo: (r: Route) => void;
  showHome?: boolean;
  /** Icon-first variant for dense tool headers. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const st = station ? stationByN(station) : undefined;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <nav
      className={`path-nav${compact ? " is-compact" : ""}`}
      aria-label={t("學習路徑導覽", "Learning path navigation")}
    >
      {showHome && (
        <button
          className="path-nav-home"
          onClick={() => onGo({ kind: "home" })}
          aria-label={compact ? t("學習路徑", "Learning path") : undefined}
          title={t("學習路徑", "Learning path")}
        >
          <RouteIcon size={16} aria-hidden="true" />
          {!compact && t("學習路徑", "Learning path")}
        </button>
      )}
      {st && (
        <button
          className="path-nav-station"
          onClick={() => onGo({ kind: "station", n: st.n, part: "lab" })}
          title={t(
            `回到第 ${st.n} 站：${st.title}`,
            `Back to station ${st.n}: ${st.title}`,
          )}
        >
          {compact
            ? t(`第 ${st.n} 站`, `Station ${st.n}`)
            : t(
                `第 ${st.n} / ${STATIONS.length} 站 · ${st.title}`,
                `Station ${st.n} / ${STATIONS.length} · ${st.title}`,
              )}
        </button>
      )}
      <button
        className="path-nav-search"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K"
        aria-label={t("跳到站點或工具", "Jump to a station or tool")}
      >
        <Search size={15} aria-hidden="true" />
        {!compact && <span>{t("跳到…", "Jump to…")}</span>}
        <kbd>Ctrl K</kbd>
      </button>
      <WorkbenchMenu onGo={onGo} />
      <button
        className="path-nav-lang"
        onClick={() => setLang(lang === "en" ? "zh" : "en")}
        lang={lang === "en" ? "zh-Hant" : "en"}
        aria-label={lang === "en" ? "切換為繁體中文" : "Switch to English"}
        title={lang === "en" ? "切換為繁體中文" : "Switch to English"}
      >
        <Languages size={15} aria-hidden="true" />
        {lang === "en" ? "中文" : "EN"}
      </button>
      <StationSwitcher open={open} onClose={() => setOpen(false)} onGo={onGo} />
    </nav>
  );
}
