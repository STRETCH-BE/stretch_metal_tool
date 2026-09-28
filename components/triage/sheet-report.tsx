"use client";

/**
 * SheetReportPanel — the verification report of a STEP sheet part: flat
 * size, cut length, pierces, net area, flat mass vs model mass, the bend
 * list (length, angle, direction, inner radius, allowance and where it
 * came from), holes grouped by size, hardware lines, masking zones,
 * countersinks and stud positions, the drawing cross-check, and the
 * flat-pattern preview with the model's features and the flagged spots
 * circled. Read-only; the flags themselves live in the flags panel.
 * File path: /components/triage/sheet-report.tsx
 *
 * Masses use the part's material density when a material is chosen,
 * else DEFAULT_DENSITY_KG_M3 (steel) — shown next to the numbers so the
 * salesperson knows which one was used.
 */

import { useMemo } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { formatNumber, interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { sheetPreviewSvg } from "@/lib/geometry/svg";
import type { PartAnnotations, PartGeometry } from "@/lib/geometry/types";
import type { Flag } from "@/lib/pricing/types";

/** Steel, used for the mass cross-check until a material is chosen. */
export const DEFAULT_DENSITY_KG_M3 = 7850;

export type SheetReportPanelProps = {
  geometry: PartGeometry;
  annotations: PartAnnotations;
  flags: Flag[];
  densityKgM3: number | null;
  flatFileId: string | null;
};

export function SheetReportPanel({ geometry, annotations, flags, densityKgM3, flatFileId }: SheetReportPanelProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.sheet;
  const sheet = geometry.sheet;
  const n = (value: number, decimals = 1) => formatNumber(value, locale, { maximumFractionDigits: decimals });
  const density = densityKgM3 ?? DEFAULT_DENSITY_KG_M3;
  const m = geometry.measures;
  const flatMassKg = (m.netAreaMm2 * (sheet?.thicknessMm ?? 0) * density) / 1e9;
  const modelMassKg = sheet?.solidVolumeMm3 !== null && sheet?.solidVolumeMm3 !== undefined ? (sheet.solidVolumeMm3 * density) / 1e9 : null;
  const deltaPct = modelMassKg !== null && flatMassKg > 0 ? ((modelMassKg - flatMassKg) / flatMassKg) * 100 : null;

  const holeGroups = useMemo(() => {
    const groups = new Map<string, { label: string; count: number }>();
    for (const h of m.holes) {
      const loop = geometry.loops.find((l) => l.id === h.loopId);
      const key = h.circular ? `d${Math.round(h.diameterMm * 10)}` : `s${Math.round((loop?.bbox.width ?? 0) * 10)}x${Math.round((loop?.bbox.height ?? 0) * 10)}`;
      const label = h.circular
        ? interpolate(t.holeRound, { diameter: n(h.diameterMm) })
        : interpolate(t.holeSlot, { w: n(loop?.bbox.width ?? 0), h: n(loop?.bbox.height ?? 0) });
      const g = groups.get(key);
      if (g) g.count += 1;
      else groups.set(key, { label, count: 1 });
    }
    return Array.from(groups.values()).sort((a, b) => b.count - a.count);
  }, [geometry.loops, m.holes, t, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    if (!sheet || geometry.entities.length === 0) return null;
    return sheetPreviewSvg(
      geometry,
      annotations,
      {
        studPositions: sheet.studPositions,
        maskingZones: sheet.maskingZones,
        countersinks: sheet.countersinks,
        blindPockets: sheet.blindPockets,
        helicalHoles: sheet.helicalHoles,
        flagged: flags.flatMap((f) => (f.locations ?? []).map((at) => ({ code: f.code, at }))),
      },
      { width: 480, height: 320, theme: "light" }
    );
  }, [geometry, annotations, sheet, flags]);

  if (!sheet) return null;
  if (!sheet.isSheetMetal) {
    return (
      <Panel title={c.upload.part.panels.sheet}>
        <p className="text-[13.5px] text-text-muted">{t.notSheet}</p>
      </Panel>
    );
  }

  const row = (label: string, value: string) => (
    <>
      <dt className="field-label mb-0">{label}</dt>
      <dd className="num">{value}</dd>
    </>
  );

  return (
    <Panel
      title={c.upload.part.panels.sheet}
      actions={
        flatFileId ? (
          <a href={routes.api.fileUrl(flatFileId)} className="btn btn-ghost btn-sm">
            {t.downloadDxf}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </a>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 text-[13.5px]">
        {preview && (
          <figure className="flex flex-col gap-1">
            <div className="overflow-hidden bg-canvas [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label={t.previewLabel} dangerouslySetInnerHTML={{ __html: preview }} />
            <figcaption className="text-[12px] text-text-faint">{t.legend}</figcaption>
          </figure>
        )}

        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {row(t.flatSize, `${n(m.bbox.width, 2)} × ${n(m.bbox.height, 2)} mm`)}
          {row(t.cutLength, `${n(m.cutLengthMm)} mm`)}
          {row(t.pierces, String(m.pierces))}
          {row(t.netArea, `${n(m.netAreaMm2, 0)} mm²`)}
          {row(t.flatMass, `${n(flatMassKg, 3)} kg`)}
          {row(t.modelMass, modelMassKg === null ? "—" : `${n(modelMassKg, 3)} kg${deltaPct === null ? "" : ` (${deltaPct >= 0 ? "+" : ""}${n(deltaPct, 1)} %)`}`)}
        </dl>
        <p className="text-[12px] text-text-faint">{interpolate(t.densityNote, { density: n(density, 0) })}</p>

        <section>
          <h3 className="field-label">{interpolate(t.bendsTitle, { count: sheet.bends.length })}</h3>
          {sheet.bends.length === 0 ? (
            <p className="text-text-faint">{t.none}</p>
          ) : (
            <ul className="list-none">
              {sheet.bends.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span className="num">{n(b.lengthMm)} mm</span>
                  <span>· {n(b.angleDeg, 0)}°</span>
                  <span>· r {n(b.innerRadiusMm, 2)}</span>
                  <span>· {b.direction === "up" ? t.up : t.down}</span>
                  <span>· BA {n(b.allowanceMm, 3)}</span>
                  <StatusChip severity={b.allowanceSource === "test_bend" ? "green" : "amber"} plain label={t.sources[b.allowanceSource]} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="field-label">{interpolate(t.holesTitle, { count: m.holes.length })}</h3>
          {holeGroups.length === 0 ? (
            <p className="text-text-faint">{t.none}</p>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {holeGroups.map((g) => (
                <li key={g.label} className="num">
                  {g.count} × {g.label}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="field-label">{interpolate(t.hardwareTitle, { count: sheet.hardware.reduce((s, h) => s + h.qty, 0) })}</h3>
          {sheet.hardware.length === 0 ? (
            <p className="text-text-faint">{t.none}</p>
          ) : (
            <ul className="list-none">
              {sheet.hardware.map((h, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="num">{h.qty} ×</span>
                  <span>{t.hardwareKinds[h.kind]}</span>
                  <span className="font-bold">{h.size ?? "?"}</span>
                  {h.productName && <span className="text-text-faint">({h.productName})</span>}
                  {h.featureCode ? <span className="mono text-[12px]">{h.featureCode}</span> : <StatusChip severity="red" plain label={t.notPriced} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {(sheet.maskingZones.length > 0 || sheet.countersinks.length > 0 || sheet.studPositions.length > 0 || sheet.blindPockets.length > 0) && (
          <section>
            <h3 className="field-label">{t.featuresTitle}</h3>
            <ul className="list-none">
              {sheet.maskingZones.length > 0 && (
                <li>
                  {interpolate(t.masking, { count: sheet.maskingZones.length, area: n(sheet.maskingZones.reduce((s, z) => s + z.areaMm2, 0), 0) })}
                  {sheet.maskingZones.some((z) => z.confirmed) && <span className="text-text-faint"> · {t.maskingConfirmed}</span>}
                </li>
              )}
              {sheet.countersinks.length > 0 && (
                <li>{interpolate(t.countersinks, { count: sheet.countersinks.length, through: n(sheet.countersinks[0].throughDiameterMm), top: n(sheet.countersinks[0].topDiameterMm) })}</li>
              )}
              {sheet.studPositions.length > 0 && <li>{interpolate(t.studs, { count: sheet.studPositions.length })}</li>}
              {sheet.blindPockets.length > 0 && <li>{interpolate(t.pockets, { count: sheet.blindPockets.length })}</li>}
            </ul>
          </section>
        )}

        {sheet.drawing && (
          <section>
            <h3 className="field-label">{t.drawingTitle}</h3>
            <ul className="list-none">
              <li>{interpolate(t.revision, { file: sheet.drawing.fileRevision ?? "—", drawing: sheet.drawing.drawingRevision ?? "—" })}</li>
              {sheet.drawing.material && <li>{interpolate(t.material, { value: sheet.drawing.material })}</li>}
              {sheet.drawing.finish && <li>{interpolate(t.finish, { value: sheet.drawing.finish })}</li>}
            </ul>
          </section>
        )}
      </div>
    </Panel>
  );
}
