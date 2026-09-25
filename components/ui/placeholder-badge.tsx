"use client";

/**
 * PlaceholderBadge — yellow "placeholder" chip shown next to any rate or
 * value that is still a [CONFIRM] guess (seed data, company data).
 * File path: /components/ui/placeholder-badge.tsx
 *
 * Copy (label + tooltip) comes from content.common.placeholder, so this is
 * a client component; it can still be rendered from server components.
 */

import { useContent } from "@/components/providers/locale";
import { StatusChip } from "@/components/ui/status-chip";

type Props = {
  className?: string;
  /** Override the default badge label (e.g. a shorter "?"). */
  label?: string;
};

export function PlaceholderBadge({ className, label }: Props) {
  const c = useContent();
  return (
    <StatusChip
      severity="placeholder"
      label={label ?? c.common.placeholder.badge}
      title={c.common.placeholder.tooltip}
      className={className}
    />
  );
}
