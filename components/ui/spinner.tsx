"use client";

/**
 * Spinner — a square red block that pulses. No round spinners in the
 * STRETCH identity.
 * File path: /components/ui/spinner.tsx
 *
 * role="status" with the loading label (content.common.ui.loading) for
 * assistive tech; `label` overrides it.
 */

import { useContent } from "@/components/providers/locale";

export type SpinnerProps = {
  label?: string;
  /** Pixel size of the square (default 12). */
  size?: number;
  className?: string;
};

export function Spinner({ label, size = 12, className = "" }: SpinnerProps) {
  const c = useContent();
  return (
    <span role="status" className={`inline-flex items-center ${className}`.trim()}>
      <span
        aria-hidden="true"
        className="inline-block animate-pulse bg-red"
        style={{ width: size, height: size }}
      />
      <span className="visually-hidden">{label ?? c.common.ui.loading}</span>
    </span>
  );
}
