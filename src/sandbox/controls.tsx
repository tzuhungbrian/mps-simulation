import { useState, type ReactNode } from "react";

/** Label + typed value + range on one compact row. */
export function Field({
  label,
  value,
  min,
  max,
  step = 0.05,
  unit = "",
  digits = 2,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (value: number) => void;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v))
      onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div className="sandbox-field">
      <span className="sandbox-field-label">{label}</span>
      <span className="sandbox-field-value">
        <input
          type="number"
          aria-label={`${label} 數值`}
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={draft ?? value.toFixed(digits)}
          onChange={(e) => {
            const text = e.target.value,
              v = Number(text);
            setDraft(text);
            if (text.trim() !== "" && v >= min && v <= max) onChange(v);
          }}
          onBlur={(e) => {
            commit(e.target.value);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(null);
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: readonly (readonly [T, string])[];
  value: T;
  onChange: (tab: T) => void;
  children?: ReactNode;
}) {
  return (
    <div className="sandbox-tabs">
      <div role="tablist" aria-label={label}>
        {tabs.map(([id, title]) => (
          <button
            key={id}
            role="tab"
            aria-selected={value === id}
            onClick={() => onChange(id)}
          >
            {title}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
