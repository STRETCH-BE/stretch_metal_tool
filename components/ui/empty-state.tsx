/**
 * EmptyState — centred panel for empty lists: title, optional body and a
 * call-to-action slot.
 * File path: /components/ui/empty-state.tsx
 *
 * Server-safe. Uses .panel; the red tick square is the only accent.
 */

import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, body, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`panel flex flex-col items-center gap-3 px-6 py-14 text-center ${className}`.trim()}
    >
      <span className="tick" aria-hidden="true" />
      <p className="text-[13px] font-bold tracking-[0.14em] uppercase">{title}</p>
      {body && <p className="max-w-md text-[13.5px] text-text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
