"use client";

/**
 * MeasuresPanel — the part's measures (cut length, pierces, bbox, blank,
 * net area, mass, smallest contour, slow contours, welds, engraving).
 * File path: /components/parts/measures-panel.tsx
 */

import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { formatKg, formatMm, formatNumber, interpolate } from "@/lib/format";
import type { PartGeometry } from "@/lib/geometry/types";

export function MeasuresPanel({ geometry }: { geometry: PartGeometry }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.measures;
  const u = c.common.units;
  const m = geometry.measures;
  const rows: [string, string][] = [
    [t.cutLength, `${formatMm(m.cutLengthMm, locale)} ${u.mm}`],
    [t.outerLength, `${formatMm(m.outerLengthMm, locale)} ${u.mm}`],
    [t.holesLength, `${formatMm(m.holesLengthMm, locale)} ${u.mm}`],
    [t.pierces, formatNumber(m.pierces, locale)],
    [t.bbox, `${formatMm(m.bbox.width, locale)} × ${formatMm(m.bbox.height, locale)} ${u.mm}`],
    [
      t.blank,
      `${formatMm(m.blank.lengthMm, locale)} × ${formatMm(m.blank.widthMm, locale)} ${u.mm} (${interpolate(t.blankMargin, { marginMm: formatMm(m.blank.marginMm, locale, 0) })})`,
    ],
    [t.netArea, `${formatNumber(m.netAreaMm2, locale, { maximumFractionDigits: 0 })} ${u.mm2}`],
    [t.mass, m.massKg === null ? t.unknown : `${formatKg(m.massKg, locale)} ${u.kg}`],
    [t.smallestContour, m.smallestContourMm === null ? "—" : `${formatMm(m.smallestContourMm, locale)} ${u.mm}`],
    [t.slowContours, formatNumber(m.slowContours.length, locale)],
    [t.bendLines, formatNumber(m.bendLines.length, locale)],
  ];
  if ((m.weldLengthMm ?? 0) > 0) rows.push([t.weldLength, `${formatMm(m.weldLengthMm ?? 0, locale)} ${u.mm}`]);
  if (m.engraveLengthMm > 0) rows.push([t.engraveLength, `${formatMm(m.engraveLengthMm, locale)} ${u.mm}`]);
  if (geometry.partCount > 1) rows.push([t.partCount, formatNumber(geometry.partCount, locale)]);

  return (
    <Panel title={c.upload.part.panels.measures} flush>
      <table className="tbl tbl-dense">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="text-text-muted">{label}</td>
              <td className="num">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
