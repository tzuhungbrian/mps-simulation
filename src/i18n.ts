export type Lang = "zh" | "en";

const KEY = "structured-light.lang";

function detect(): Lang {
  try {
    const q = new URLSearchParams(globalThis.location?.search).get("lang");
    if (q === "en" || q === "zh") return q;
    const saved = globalThis.localStorage?.getItem(KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  return "zh";
}

/** Fixed for the page's lifetime: module-level text is evaluated once, so switching reloads. */
export const lang: Lang = detect();

/** Pick the text for the current language; both versions are required, so a missing translation fails tsc. */
export function t<T>(zh: T, en: T): T {
  return lang === "en" ? en : zh;
}

export function setLang(next: Lang) {
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage the URL parameter still carries the choice.
  }
  const url = new URL(location.href);
  if (next === "en") url.searchParams.set("lang", "en");
  else url.searchParams.delete("lang");
  location.replace(url);
}

if (typeof document !== "undefined") {
  document.documentElement.lang = lang === "en" ? "en" : "zh-Hant";
  document.title = t(
    "Structured Light Lab · 結構光實驗室",
    "Structured Light Lab",
  );
}
