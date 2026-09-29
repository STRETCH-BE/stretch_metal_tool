"use client";

/**
 * WeldsTable — list of the weld seams marked in the viewer: process,
 * bead, pattern (stitch bead/pitch), sides, geometric and effective
 * length. When the part belongs to a welded assembly (`handoff`), every
 * row gets "Add as assembly seam" — the seam is stored at assembly level
 * through addSeamFromPart (components/parts/part-workspace.tsx) and the
 * row then reads "added", "paired with the neighbour's edge (not
 * counted)" or "already added" (double-click guard: the button is
 * disabled while pending and for welds the assembly already holds).
 * File path: /components/parts/welds-table.tsx
 */

import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatMm, interpolate } from "@/lib/format";
import type { WeldAnnotation } from "@/lib/geometry/types";
import type { SeamHandoffState } from "@/components/quote/seam-handoff";

export type WeldsHandoff = {
  assemblyName: string;
  /** Per weld id (components/quote/seam-handoff.ts seamStateForWeld). */
  states: Readonly<Record<string, SeamHandoffState>>;
  disabled: boolean;
  onAdd: (weld: WeldAnnotation) => void;
};

export type WeldsTableProps = {
  welds: WeldAnnotation[];
  handoff?: WeldsHandoff | null;
};

export function WeldsTable({ welds, handoff = null }: WeldsTableProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.welds;
  const h = c.quote.builder.assembly.handoff;
  return (
    <Panel
      title={c.upload.part.panels.welds}
      flush
      actions={handoff ? <StatusChip severity="dark" plain label={interpolate(h.partOf, { name: handoff.assemblyName })} /> : undefined}
    >
      {welds.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-text-muted">{t.empty}</p>
      ) : (
        <TableWrap>
          <Table dense>
            <thead>
              <tr>
                <Th>{t.process}</Th>
                <Th align="num">{t.bead}</Th>
                <Th>{t.pattern}</Th>
                <Th align="num">{t.sides}</Th>
                <Th align="num">{t.length}</Th>
                <Th align="num">{t.effective}</Th>
                {handoff && <Th>{c.quote.builder.assembly.seams.title}</Th>}
              </tr>
            </thead>
            <tbody>
              {welds.map((weld) => {
                const state = handoff?.states[weld.id] ?? "idle";
                return (
                  <tr key={weld.id}>
                    <Td>{c.flags.weldProcesses[weld.process]}</Td>
                    <Td align="num">{formatMm(weld.beadMm, locale)}</Td>
                    <Td>
                      {t.patterns[weld.pattern]}
                      {weld.pattern === "stitch" && weld.stitch && (
                        <span className="text-text-faint"> {interpolate(t.stitchInfo, { bead: formatMm(weld.stitch.beadLengthMm, locale, 0), pitch: formatMm(weld.stitch.pitchMm, locale, 0) })}</span>
                      )}
                    </Td>
                    <Td align="num">{weld.sides}</Td>
                    <Td align="num">{formatMm(weld.lengthMm, locale)}</Td>
                    <Td align="num">{formatMm(weld.effectiveLengthMm, locale)}</Td>
                    {handoff && (
                      <Td>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {state === "idle" && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={handoff.disabled} onClick={() => handoff.onAdd(weld)}>
                              {h.add}
                            </button>
                          )}
                          {state === "pending" && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled aria-busy="true">
                              {h.pending}
                            </button>
                          )}
                          {state === "added" && <StatusChip severity="green" label={h.added} />}
                          {state === "paired" && <StatusChip severity="neutral" label={h.paired} />}
                          {state === "already" && <StatusChip severity="neutral" plain label={h.alreadyAdded} />}
                        </span>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}
