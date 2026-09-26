"use client";

/**
 * FlagsPanel — this part's feasibility flags from the quote's last
 * pricing run (quote_items.flags), rendered through content.flags with
 * severity chips.
 * File path: /components/parts/flags-panel.tsx
 */

import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import type { Flag } from "@/lib/pricing/types";
import { flagLabel, flagMessage } from "@/lib/parts/flag-message";

const ORDER: Record<Flag["severity"], number> = { red: 0, amber: 1, green: 2 };

export function FlagsPanel({ flags, priced }: { flags: Flag[]; priced: boolean }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.flags;
  const sorted = [...flags].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return (
    <Panel title={c.upload.part.panels.flags}>
      {!priced ? (
        <p className="text-[13px] text-text-muted">{t.notPriced}</p>
      ) : sorted.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((flag, i) => (
            <li key={`${flag.code}-${i}`} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip severity={flag.severity} label={c.flags.severity[flag.severity]} />
                <span className="text-[13px] font-bold">{flagLabel(c.flags, flag)}</span>
              </div>
              <p className="text-[13px] text-text-muted">{flagMessage(c.flags, flag, locale)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-text-faint">{t.hint}</p>
    </Panel>
  );
}
