"use client";

/**
 * RollSummary — the part-level rolling annotation (radius, axis, arc
 * angle, axis length, developed width, cone prefill) or the "not rolled"
 * hint.
 * File path: /components/parts/roll-summary.tsx
 */

import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { formatMm, formatNumber, interpolate } from "@/lib/format";
import type { RollAnnotation } from "@/lib/geometry/types";

export function RollSummary({ roll }: { roll: RollAnnotation | null }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.roll;
  const u = c.common.units;
  if (!roll) {
    return (
      <Panel title={c.upload.part.panels.roll}>
        <p className="text-[13px] text-text-muted">{t.none}</p>
      </Panel>
    );
  }
  const rows: [string, string][] = [
    [t.radius, `${formatMm(roll.radiusMm, locale)} ${u.mm}`],
    [t.axis, t.axes[roll.axis]],
    [t.arcAngle, `${formatNumber(roll.arcAngleDeg, locale)}°`],
    [t.axisLength, `${formatMm(roll.axisLengthMm, locale)} ${u.mm}`],
    [t.developedWidth, `${formatMm(roll.developedWidthMm, locale)} ${u.mm}`],
  ];
  if (roll.cone) {
    rows.push([
      t.cone,
      interpolate(t.coneInfo, {
        inner: formatMm(roll.cone.innerRadiusMm, locale),
        outer: formatMm(roll.cone.outerRadiusMm, locale),
        sweep: formatNumber(roll.cone.sweepDeg, locale),
      }),
    ]);
  }
  return (
    <Panel title={c.upload.part.panels.roll} flush>
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
