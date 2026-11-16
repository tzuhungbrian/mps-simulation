import { useSyncExternalStore } from "react";
import { STATIONS, type Part, type Station } from "./stations";

const KEY = "structured-light.path.v1";

export interface StationProgress {
  theory?: boolean;
  lab?: boolean;
  checks?: Record<string, boolean>;
}
export interface PathProgress {
  current: number | null;
  part: Part;
  stations: Record<number, StationProgress>;
}
export type StationState = "done" | "partial" | "none" | "planned";

const EMPTY: PathProgress = { current: null, part: "theory", stations: {} };

function read(): { progress: PathProgress; persistent: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { progress: EMPTY, persistent: true };
    const parsed = JSON.parse(raw) as Partial<PathProgress>;
    return {
      progress: {
        current: typeof parsed.current === "number" ? parsed.current : null,
        part:
          parsed.part === "lab" || parsed.part === "check"
            ? parsed.part
            : "theory",
        stations:
          parsed.stations && typeof parsed.stations === "object"
            ? parsed.stations
            : {},
      },
      persistent: true,
    };
  } catch {
    return { progress: EMPTY, persistent: false };
  }
}

let snapshot = read();
const listeners = new Set<() => void>();

function commit(next: PathProgress) {
  let persistent = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    persistent = false;
  }
  snapshot = { progress: next, persistent };
  listeners.forEach((l) => l());
}

function patchStation(
  n: number,
  patch: (s: StationProgress) => StationProgress,
) {
  const { progress } = snapshot;
  commit({
    ...progress,
    stations: { ...progress.stations, [n]: patch(progress.stations[n] ?? {}) },
  });
}

export const pathProgress = {
  visit(n: number, part: Part) {
    const { progress } = snapshot;
    if (progress.current === n && progress.part === part) return;
    commit({ ...progress, current: n, part });
  },
  markTheory(n: number) {
    patchStation(n, (s) => ({ ...s, theory: true }));
  },
  markLab(n: number) {
    if (snapshot.progress.stations[n]?.lab) return;
    patchStation(n, (s) => ({ ...s, lab: true }));
  },
  setCheck(n: number, id: string, value: boolean) {
    patchStation(n, (s) => ({ ...s, checks: { ...s.checks, [id]: value } }));
  },
  /** Lab achievements are sticky: once reached they stay reached. */
  reportAuto(done: Record<string, boolean>) {
    const { progress } = snapshot;
    const stations = { ...progress.stations };
    let changed = false;
    for (const st of STATIONS)
      for (const c of st.checks)
        if (c.auto && done[c.id] && !stations[st.n]?.checks?.[c.id]) {
          stations[st.n] = {
            ...stations[st.n],
            lab: true,
            checks: { ...stations[st.n]?.checks, [c.id]: true },
          };
          changed = true;
        }
    if (changed) commit({ ...progress, stations });
  },
  reset() {
    commit(EMPTY);
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePathProgress() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function stationState(st: Station, p: PathProgress): StationState {
  if (st.planned) return "planned";
  const s = p.stations[st.n];
  if (!s) return "none";
  const passed = st.checks.filter((c) => s.checks?.[c.id]).length;
  if (st.checks.length && passed === st.checks.length) return "done";
  return s.theory || s.lab || passed ? "partial" : "none";
}

export function checksPassed(st: Station, p: PathProgress) {
  const s = p.stations[st.n];
  return st.checks.filter((c) => s?.checks?.[c.id]).length;
}
