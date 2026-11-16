import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

function render(tex: string, displayMode: boolean) {
  // Inputs are static strings authored in this repo; trust stays off.
  return katex.renderToString(tex, { displayMode, throwOnError: false });
}

/** Inline math. */
export function M({ children }: { children: string }) {
  const html = useMemo(() => render(children, false), [children]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Display math in the article's formula box. */
export function MathBlock({ children }: { children: string }) {
  const html = useMemo(() => render(children, true), [children]);
  return (
    <div className="calib-formula" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
