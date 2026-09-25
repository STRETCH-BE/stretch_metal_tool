/**
 * StatusChip — square status chip: ▮ block + uppercase label, never a pill.
 * File path: /components/ui/status-chip.tsx
 *
 * Severity maps 1:1 to the .chip-* classes in globals.css. `title` is the
 * hover/assistive explanation (e.g. the rule that fired). Server-safe.
 */

import type { HTMLAttributes } from "react";

export type ChipSeverity =
  | "green"
  | "amber"
  | "red"
  | "neutral"
  | "placeholder"
  | "dark";

export type StatusChipProps = Omit<HTMLAttributes<HTMLSpanElement>, "title"> & {
  severity: ChipSeverity;
  label: string;
  title?: string;
  /** Hides the ▮ block (plain hard-edged tag). */
  plain?: boolean;
};

export function StatusChip({
  severity,
  label,
  title,
  plain = false,
  className = "",
  ...rest
}: StatusChipProps) {
  return (
    <span
      className={`chip chip-${severity} ${plain ? "chip-plain" : ""} ${className}`.trim()}
      title={title}
      {...rest}
    >
      {label}
    </span>
  );
}
