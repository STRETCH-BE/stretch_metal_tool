/**
 * Eyebrow — red bold number + tracked uppercase label above every section
 * heading. The STRETCH pattern: `01 — USŁUGI`.
 * File path: /components/ui/eyebrow.tsx
 *
 * Colours adapt per surface via the .section-dark / .section-red parent
 * classes in globals.css (brighter red on black for WCAG AA at 13px), so
 * this component carries no tone prop — put it inside the right section.
 */

import type { ReactNode } from "react";

type Props = {
  /** Two-digit section number, e.g. "01". Omit for unnumbered eyebrows. */
  number?: string;
  children: ReactNode;
  className?: string;
};

export function Eyebrow({ number, children, className = "" }: Props) {
  return (
    <div className={`eyebrow ${className}`.trim()}>
      {number && (
        <span className="eyebrow-num" aria-hidden="true">
          {number}
        </span>
      )}
      <span className="eyebrow-rule" aria-hidden="true" />
      <span className="eyebrow-label">{children}</span>
    </div>
  );
}
