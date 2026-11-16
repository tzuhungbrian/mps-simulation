import { STATIONS, type Part, type Route, type ToolId } from "./stations";

const TOOLS: ToolId[] = [
  "sandbox",
  "analysis",
  "aoi",
  "calib-lab",
  "guided",
  "explore",
];
const PARTS: Part[] = ["theory", "lab", "check"];
const SESSION_KEY = "structured-light.view-mode";

export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const workspace = q.get("workspace");
  const station = Number(q.get("station"));
  const validStation = STATIONS.some((s) => s.n === station)
    ? station
    : undefined;
  if (workspace === "calibration")
    return { kind: "station", n: 2, part: "theory" };
  if (workspace && (TOOLS as string[]).includes(workspace))
    return {
      kind: "tool",
      tool: workspace as ToolId,
      station: validStation,
      step: q.get("step") ?? undefined,
    };
  if (validStation) {
    const part = q.get("part");
    return {
      kind: "station",
      n: validStation,
      part: (PARTS as string[]).includes(part ?? "")
        ? (part as Part)
        : "theory",
    };
  }
  if (q.has("path")) return { kind: "home" };
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && (TOOLS as string[]).includes(saved))
      return { kind: "tool", tool: saved as ToolId };
  } catch {
    /* No session storage: fall back to the learning path. */
  }
  return { kind: "home" };
}

export function routeUrl(route: Route): string {
  const url = new URL(location.href);
  url.search = "";
  if (route.kind === "station") {
    url.searchParams.set("station", String(route.n));
    if (route.part !== "theory") url.searchParams.set("part", route.part);
  } else if (route.kind === "tool") {
    url.searchParams.set("workspace", route.tool);
    if (route.station) url.searchParams.set("station", String(route.station));
    if (route.step) url.searchParams.set("step", route.step);
  }
  return url.toString();
}

export function rememberRoute(route: Route) {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      route.kind === "tool" ? route.tool : "home",
    );
  } catch {
    /* Optional preference only. */
  }
}
