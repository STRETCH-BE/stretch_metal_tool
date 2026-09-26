"use client";

/**
 * Viewer — live measures strip above the canvas.
 * File path: /components/viewer/measures-strip.tsx
 *
 * Receives the geometry AFTER annotations were applied (the viewer runs
 * applyAnnotationsSync in a useMemo) and shows cut length, pierces, bend
 * count, effective weld length, bounding box and mass (only when the
 * engine had thickness + density). Numbers are locale formatted, right
 * aligned with tabular figures (.num). Preview only — the server prices.
 */

import { memo } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import type { PartGeometry } from "@/lib/geometry/types";
import { formatKg, formatMm, formatNumber } from "@/lib/format";

export const MeasuresStrip = memo(function MeasuresStrip({ geometry }: { geometry: PartGeometry }) {
  const content = useContent();
  const c = content.viewer;
  const locale = useLocale();
  const m = geometry.measures;
  const items: { key: string; label: string; value: string }[] = [
    { key: "cut", label: c.measures.cutLength, value: `${formatMm(m.cutLengthMm, locale)} ${c.units.mm}` },
    { key: "pierces", label: c.measures.pierces, value: formatNumber(m.pierces, locale) },
    { key: "bends", label: c.measures.bends, value: formatNumber(m.bendLines.length, locale) },
    { key: "weld", label: c.measures.weldLength, value: `${formatMm(m.weldLengthMm ?? 0, locale)} ${c.units.mm}` },
    {
      key: "bbox",
      label: c.measures.bbox,
      value: `${formatMm(m.bbox.width, locale)} × ${formatMm(m.bbox.height, locale)} ${c.units.mm}`,
    },
    {
      key: "mass",
      label: c.measures.mass,
      value: m.massKg !== null ? `${formatKg(m.massKg, locale)} ${c.units.kg}` : c.measures.unknown,
    },
  ];
  return (
    <dl className="panel flex flex-wrap items-stretch divide-x divide-border" aria-label={c.measures.title} data-measures="true">
      {items.map((item) => (
        <div key={item.key} className="flex min-w-[120px] flex-1 flex-col px-3 py-2">
          <dt className="field-label mb-1!">{item.label}</dt>
          <dd className="num text-[15px] font-bold" data-measure={item.key}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
});
