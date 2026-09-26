/**
 * QuoteStatusChip — square status chip for a quote status, plus the
 * status → severity map shared with the list filters. Server-safe.
 * File path: /components/quote/quote-status-chip.tsx
 */

import type { Content } from "@/content";
import type { QuoteStatus } from "@/lib/db/types";
import { StatusChip, type ChipSeverity } from "@/components/ui/status-chip";

export const QUOTE_STATUS_SEVERITY: Record<QuoteStatus, ChipSeverity> = {
  draft: "neutral",
  pending_override: "amber",
  sent: "dark",
  won: "green",
  lost: "red",
};

export const QUOTE_STATUS_ORDER: QuoteStatus[] = ["draft", "pending_override", "sent", "won", "lost"];

export function QuoteStatusChip({ status, content, className }: { status: QuoteStatus; content: Content; className?: string }) {
  return <StatusChip severity={QUOTE_STATUS_SEVERITY[status]} label={content.common.status[status]} className={className} />;
}
