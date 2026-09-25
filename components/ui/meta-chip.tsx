/**
 * MetaChip — small square-edged chip for inline tags/meta (capability tags
 * on service cards, the group badge in the hero).
 * File path: /components/ui/meta-chip.tsx
 *
 * The sufit original was a rounded pill — StretchMetal's identity forbids
 * radius, so this is a hard rectangle with a hairline border.
 */

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  tone?: "light" | "dark";
  className?: string;
};

export function MetaChip({ children, tone = "dark", className = "" }: Props) {
  const toneClasses =
    tone === "dark"
      ? "border-line-dark text-on-dark-soft"
      : "border-border-2 text-text-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${toneClasses} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
