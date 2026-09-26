"use client";

/**
 * WeldsTable — read-only list of the weld seams marked in the viewer:
 * process, bead, pattern (stitch bead/pitch), sides, geometric and
 * effective length.
 * File path: /components/parts/welds-table.tsx
 */

import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatMm, interpolate } from "@/lib/format";
import type { WeldAnnotation } from "@/lib/geometry/types";

export function WeldsTable({ welds }: { welds: WeldAnnotation[] }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.welds;
  return (
    <Panel title={c.upload.part.panels.welds} flush>
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
              </tr>
            </thead>
            <tbody>
              {welds.map((weld) => (
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
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}
