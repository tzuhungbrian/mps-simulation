import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

export function InfoButton({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="sandbox-info"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={onToggle}
    >
      <Info size={15} />
    </button>
  );
}

/** Heading whose explanation stays hidden until the info button is pressed. */
export function InfoHeading({
  title,
  level = 3,
  children,
}: {
  title: string;
  level?: 2 | 3;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <>
      <div className="sandbox-heading">
        <Tag className={level === 3 ? "sandbox-group" : undefined}>{title}</Tag>
        {children && (
          <InfoButton
            label={`${title}說明`}
            open={open}
            onToggle={() => setOpen((v) => !v)}
          />
        )}
      </div>
      {children && open && <div className="sandbox-info-panel">{children}</div>}
    </>
  );
}
