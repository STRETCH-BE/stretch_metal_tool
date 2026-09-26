"use client";

/**
 * WeldingSeamsEditor — seams of a welding-only quote: a dense row editor
 * (label, process, bead, length, pattern full/stitch with segment +
 * pitch, sides, qty) plus the number of customer-supplied parts, and an
 * import of the seams marked on the quote's drawings (parts' weld
 * annotations).
 * File path: /components/quote/welding-seams-editor.tsx
 *
 * Every edit is pushed up for the live preview; Save persists through
 * updateWeldingOnly (server re-price). Imported seams get stable ids
 * (`part:<partId>:<weldId>`) so a second import replaces instead of
 * duplicating them.
 */

import { useContent } from "@/components/providers/locale";
import { Field, Input, Select } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { interpolate } from "@/lib/format";
import type { WeldingOnlySeam } from "@/lib/pricing/types";
import { parseAnnotations, WELD_PROCESSES } from "@/lib/quotes/schema";
import type { QuoteBundle, WeldingOnlyBlock } from "@/lib/quotes/types";

export type WeldingSeamsEditorProps = {
  bundle: QuoteBundle;
  value: WeldingOnlyBlock;
  editable: boolean;
  pending: boolean;
  dirty: boolean;
  onChange: (next: WeldingOnlyBlock) => void;
  onSave: () => void;
};

let seamSeq = 0;

export function seamsFromParts(bundle: QuoteBundle): WeldingOnlySeam[] {
  const qtyByPart = new Map(bundle.items.map((i) => [i.part_id, Number(i.qty)]));
  const seams: WeldingOnlySeam[] = [];
  for (const part of bundle.parts) {
    const annotations = parseAnnotations(part.annotations);
    for (const weld of annotations.welds) {
      seams.push({
        id: `part:${part.id}:${weld.id}`,
        label: `${part.name} · ${weld.id}`,
        process: weld.process,
        beadMm: weld.beadMm,
        lengthMm: weld.lengthMm,
        pattern: weld.pattern,
        stitch: weld.pattern === "stitch" ? (weld.stitch ?? { beadLengthMm: 30, pitchMm: 60 }) : null,
        sides: weld.sides,
        qty: qtyByPart.get(part.id) ?? 1,
      });
    }
  }
  return seams;
}

export function WeldingSeamsEditor({ bundle, value, editable, pending, dirty, onChange, onSave }: WeldingSeamsEditorProps) {
  const c = useContent();
  const t = c.quote.builder.welding;
  const { toast } = useToast();

  const setSeam = (index: number, next: WeldingOnlySeam) =>
    onChange({ ...value, seams: value.seams.map((s, i) => (i === index ? next : s)) });
  const removeSeam = (index: number) => onChange({ ...value, seams: value.seams.filter((_, i) => i !== index) });
  const addSeam = () => {
    seamSeq += 1;
    const n = value.seams.length + 1;
    onChange({
      ...value,
      seams: [
        ...value.seams,
        {
          id: `seam-${Date.now()}-${seamSeq}`,
          label: interpolate(t.seamDefaultLabel, { n }),
          process: "mig_mag",
          beadMm: 4,
          lengthMm: 100,
          pattern: "full",
          stitch: null,
          sides: 1,
          qty: 1,
        },
      ],
    });
  };
  const importSeams = () => {
    const imported = seamsFromParts(bundle);
    if (imported.length === 0) {
      toast(t.importedNone, { tone: "neutral" });
      return;
    }
    const importedIds = new Set(imported.map((s) => s.id));
    onChange({ ...value, seams: [...value.seams.filter((s) => !importedIds.has(s.id)), ...imported] });
    toast(interpolate(t.imported, { count: imported.length }), { tone: "success" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t.partsCount} htmlFor="welding-parts" help={t.partsCountHelp}>
          <NumberInput
            id="welding-parts"
            value={value.partsCount}
            onValueChange={(v) => onChange({ ...value, partsCount: Math.max(0, Math.round(v ?? 0)) })}
            decimals={0}
            min={0}
            dense
            inline
            className="w-[120px]"
            disabled={!editable}
          />
        </Field>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addSeam} disabled={pending}>
              {t.addSeam}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={importSeams} disabled={pending}>
              {t.importFromParts}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={pending || !dirty}>
              {t.save}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
          </div>
        )}
      </div>

      <TableWrap>
        <Table dense>
          <thead>
            <tr>
              <Th>{t.columns.label}</Th>
              <Th>{t.columns.process}</Th>
              <Th align="num">{t.columns.bead}</Th>
              <Th align="num">{t.columns.length}</Th>
              <Th>{t.columns.pattern}</Th>
              <Th align="num">{t.columns.beadLength}</Th>
              <Th align="num">{t.columns.pitch}</Th>
              <Th align="num">{t.columns.sides}</Th>
              <Th align="num">{t.columns.qty}</Th>
              {editable && <Th>{c.common.table.actions}</Th>}
            </tr>
          </thead>
          <tbody>
            {value.seams.length === 0 ? (
              <tr className="row-muted">
                <Td colSpan={editable ? 10 : 9} className="py-6 text-center">
                  {t.empty}
                </Td>
              </tr>
            ) : (
              value.seams.map((seam, index) => (
                <tr key={seam.id}>
                  <Td>
                    <Input
                      aria-label={t.columns.label}
                      value={seam.label}
                      dense
                      inline
                      className="w-[160px]"
                      maxLength={120}
                      disabled={!editable}
                      onChange={(e) => setSeam(index, { ...seam, label: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Select
                      aria-label={t.columns.process}
                      value={seam.process}
                      dense
                      inline
                      disabled={!editable}
                      onChange={(e) => setSeam(index, { ...seam, process: e.target.value as WeldingOnlySeam["process"] })}
                    >
                      {WELD_PROCESSES.map((p) => (
                        <option key={p} value={p}>
                          {t.processes[p]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td align="num">
                    <NumberInput
                      aria-label={t.columns.bead}
                      value={seam.beadMm}
                      onValueChange={(v) => setSeam(index, { ...seam, beadMm: v ?? 0 })}
                      decimals={1}
                      min={0}
                      dense
                      inline
                      className="w-[70px]"
                      disabled={!editable}
                    />
                  </Td>
                  <Td align="num">
                    <NumberInput
                      aria-label={t.columns.length}
                      value={seam.lengthMm}
                      onValueChange={(v) => setSeam(index, { ...seam, lengthMm: v ?? 0 })}
                      decimals={1}
                      min={0}
                      dense
                      inline
                      className="w-[90px]"
                      disabled={!editable}
                    />
                  </Td>
                  <Td>
                    <Select
                      aria-label={t.columns.pattern}
                      value={seam.pattern}
                      dense
                      inline
                      disabled={!editable}
                      onChange={(e) => {
                        const pattern = e.target.value as "full" | "stitch";
                        setSeam(index, {
                          ...seam,
                          pattern,
                          stitch: pattern === "stitch" ? (seam.stitch ?? { beadLengthMm: 30, pitchMm: 60 }) : null,
                        });
                      }}
                    >
                      <option value="full">{t.patterns.full}</option>
                      <option value="stitch">{t.patterns.stitch}</option>
                    </Select>
                  </Td>
                  <Td align="num">
                    <NumberInput
                      aria-label={t.columns.beadLength}
                      value={seam.stitch?.beadLengthMm ?? null}
                      onValueChange={(v) =>
                        setSeam(index, { ...seam, stitch: { beadLengthMm: v ?? 0, pitchMm: seam.stitch?.pitchMm ?? 60 } })
                      }
                      decimals={1}
                      min={0}
                      dense
                      inline
                      className="w-[70px]"
                      disabled={!editable || seam.pattern !== "stitch"}
                    />
                  </Td>
                  <Td align="num">
                    <NumberInput
                      aria-label={t.columns.pitch}
                      value={seam.stitch?.pitchMm ?? null}
                      onValueChange={(v) =>
                        setSeam(index, { ...seam, stitch: { beadLengthMm: seam.stitch?.beadLengthMm ?? 30, pitchMm: v ?? 1 } })
                      }
                      decimals={1}
                      min={0.1}
                      dense
                      inline
                      className="w-[70px]"
                      disabled={!editable || seam.pattern !== "stitch"}
                    />
                  </Td>
                  <Td align="num">
                    <Select
                      aria-label={t.columns.sides}
                      value={String(seam.sides)}
                      dense
                      inline
                      disabled={!editable}
                      onChange={(e) => setSeam(index, { ...seam, sides: e.target.value === "2" ? 2 : 1 })}
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </Select>
                  </Td>
                  <Td align="num">
                    <NumberInput
                      aria-label={t.columns.qty}
                      value={seam.qty}
                      onValueChange={(v) => setSeam(index, { ...seam, qty: Math.max(1, Math.round(v ?? 1)) })}
                      decimals={0}
                      min={1}
                      dense
                      inline
                      className="w-[70px]"
                      disabled={!editable}
                    />
                  </Td>
                  {editable && (
                    <Td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSeam(index)} disabled={pending}>
                        {t.removeSeam}
                      </button>
                    </Td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}
