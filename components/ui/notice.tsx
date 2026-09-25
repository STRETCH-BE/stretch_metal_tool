/**
 * Notice + FormError — inline message boxes (form-level errors, success
 * confirmations, info). Hard-edged, left bar in the signal colour.
 * File path: /components/ui/notice.tsx
 *
 * Server-safe. FormError is Notice with tone="error" and role="alert";
 * it renders nothing when there is no message so it can sit in a form
 * unconditionally.
 */

import type { ReactNode } from "react";

export type NoticeTone = "error" | "success" | "info";

const TONE: Record<NoticeTone, { bar: string; bg: string; text: string }> = {
  error: {
    bar: "var(--color-red)",
    bg: "var(--color-flag-red-soft)",
    text: "var(--color-red)",
  },
  success: {
    bar: "var(--color-flag-green)",
    bg: "var(--color-flag-green-soft)",
    text: "var(--color-flag-green)",
  },
  info: {
    bar: "var(--color-black)",
    bg: "var(--color-surface)",
    text: "var(--color-text-body)",
  },
};

export type NoticeProps = {
  tone?: NoticeTone;
  children: ReactNode;
  role?: "alert" | "status";
  className?: string;
};

export function Notice({ tone = "info", children, role, className = "" }: NoticeProps) {
  const colours = TONE[tone];
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={`px-4 py-3 text-[13.5px] font-medium ${className}`.trim()}
      style={{
        borderLeft: `3px solid ${colours.bar}`,
        background: colours.bg,
        color: colours.text,
      }}
    >
      {children}
    </div>
  );
}

export function FormError({
  message,
  className = "",
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <Notice tone="error" role="alert" className={className}>
      {message}
    </Notice>
  );
}
