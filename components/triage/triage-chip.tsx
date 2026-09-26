"use client";

/**
 * TriageChip — square status chip for a triage state (green / amber /
 * red) labelled from content.flags.triage.
 * File path: /components/triage/triage-chip.tsx
 */

import { useContent } from "@/components/providers/locale";
import { StatusChip } from "@/components/ui/status-chip";
import type { TriageState } from "@/lib/geometry/types";
import { triageLabel, triageSeverity } from "@/lib/parts/flag-message";

export function TriageChip({ state, className = "" }: { state: TriageState | null; className?: string }) {
  const c = useContent();
  if (!state) return <StatusChip severity="neutral" plain label={c.upload.intake.parts.noTriage} className={className} />;
  return (
    <StatusChip
      severity={triageSeverity(state)}
      label={triageLabel(c.flags, state)}
      title={c.flags.triage[state].message}
      className={className}
    />
  );
}
