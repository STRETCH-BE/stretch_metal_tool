/**
 * Flag text for the quote builder + FlagChip — thin wrappers over the
 * shared helpers in lib/parts/flag-message.ts (owned by the intake
 * module, which also owns content/flags: `flags.flags[code] = { label,
 * message }` with {param} placeholders, enum params translated, numbers
 * formatted per locale). A code without a message renders as the code
 * itself, so a new rule never crashes the builder.
 * File path: /components/quote/flag-message.tsx
 *
 * Server-safe (no hooks); FlagChip takes the resolved Content so it
 * renders from server and client components alike.
 */

import type { Content } from "@/content";
import { flagLabel as sharedFlagLabel, flagMessage as sharedFlagMessage } from "@/lib/parts/flag-message";
import type { Flag } from "@/lib/pricing/types";
import { StatusChip } from "@/components/ui/status-chip";

/** Localised, interpolated message for a flag — or the code when no text exists yet. */
export function flagMessage(content: Content, flag: Pick<Flag, "code" | "params">): string {
  return sharedFlagMessage(content.flags, flag, content.locale);
}

/** Short label for a flag chip — or the code. */
export function flagLabel(content: Content, flag: Pick<Flag, "code">): string {
  return sharedFlagLabel(content.flags, flag);
}

export function FlagChip({ content, flag, className }: { content: Content; flag: Flag; className?: string }) {
  return (
    <StatusChip
      severity={flag.severity}
      label={flagLabel(content, flag)}
      title={flagMessage(content, flag)}
      className={className}
    />
  );
}
