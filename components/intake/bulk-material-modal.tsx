"use client";

/**
 * BulkMaterialModal — "change material / thickness" for several parts of
 * a quote at once: a button that opens a dialog with a part checklist
 * (select all / none), a material select and a thickness input, and
 * applies the change through the setPartsMaterial server action.
 * File path: /components/intake/bulk-material-modal.tsx
 *
 * Mounted in the parts panel header on the upload page and on the quote
 * page. "Keep" is the default for both fields, so a user can change only
 * the thickness of ten parts without touching their materials; an empty
 * thickness means keep. The material select also offers "remove
 * material" (null), the same value the single-part form allows. After a
 * successful apply the route is refreshed so the server lists (and the
 * re-priced quote) re-render; the dialog closes and a toast reports how
 * many parts changed. Every control is a native checkbox, select, input
 * or button — keyboard reachable in DOM order inside the focus trap.
 * Market version: the material list marks materials without a laser row
 * as "not benchmarked" (disabled) and the thickness becomes a select of
 * the chosen material's benchmarked thicknesses (ThicknessInput); with
 * "keep material" the thickness stays a free number, since the parts may
 * differ in material.
 */

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useContent, useLocale } from "@/components/providers/locale";
import { ThicknessInput } from "@/components/parts/thickness-input";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatMm, interpolate } from "@/lib/format";
import { setPartsMaterial } from "@/lib/parts/actions";
import type { MaterialChoice } from "@/lib/parts/material-choices";

export type BulkMaterialPart = { id: string; name: string; materialCode: string | null; thicknessMm: number | null };

export type BulkMaterialModalProps = {
  quoteId: string;
  parts: BulkMaterialPart[];
  materials: MaterialChoice[];
  disabled?: boolean;
  className?: string;
};

/** Sentinel select values — never valid material codes (codes are trimmed, ≤ 40 chars, no underscores at both ends in seed). */
const KEEP = "__keep__";
const CLEAR = "__clear__";

export function BulkMaterialModal({ quoteId, parts, materials, disabled = false, className = "btn btn-ghost btn-sm" }: BulkMaterialModalProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.intake.parts.bulk;
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [material, setMaterial] = useState<string>(KEEP);
  const [thickness, setThickness] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const market = materials.some((m) => m.thicknessesMm !== null);
  const choice = materials.find((m) => m.code === material) ?? null;
  const allSelected = parts.length > 0 && parts.every((p) => selected.has(p.id));
  const hasChange = material !== KEEP || thickness !== null;
  const canApply = selected.size > 0 && hasChange && !pending;

  const reset = () => {
    setSelected(new Set());
    setMaterial(KEEP);
    setThickness(null);
  };
  const close = () => {
    if (pending) return;
    setOpen(false);
    reset();
  };
  const selectAll = () => setSelected(new Set(parts.map((p) => p.id)));
  const selectNone = () => setSelected(new Set());
  const toggle = (partId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });

  const apply = () =>
    startTransition(async () => {
      const result = await setPartsMaterial(quoteId, {
        partIds: [...selected],
        ...(material === KEEP ? {} : { materialCode: material === CLEAR ? null : material }),
        ...(thickness === null ? {} : { thicknessMm: thickness }),
      });
      if (result.ok) {
        toast(interpolate(t.applied, { count: result.data.updated }), { tone: "success" });
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast(c.upload.errors[result.error] ?? c.upload.errors.generic, { tone: "error" });
      }
    });

  const current = (p: BulkMaterialPart): string => {
    const code = p.materialCode ?? c.upload.intake.parts.noMaterial;
    return p.thicknessMm !== null ? `${code} · ${formatMm(p.thicknessMm, locale)} ${c.common.units.mm}` : code;
  };

  return (
    <>
      <button type="button" className={className} disabled={disabled || parts.length === 0} onClick={() => setOpen(true)}>
        {t.open}
      </button>
      <Modal
        open={open}
        onClose={close}
        title={t.title}
        size="md"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={close} disabled={pending}>
              {c.common.actions.cancel}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={!canApply}>
              {pending ? c.common.actions.saving : t.apply}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
          </div>
        }
      >
        <p className="mb-3 text-[13px] text-text-muted">{t.intro}</p>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[12.5px]">
          <button type="button" className="lnk" onClick={selectAll} disabled={allSelected}>
            {t.selectAll}
          </button>
          <button type="button" className="lnk" onClick={selectNone} disabled={selected.size === 0}>
            {t.selectNone}
          </button>
          <span className="text-text-faint">{interpolate(t.selected, { selected: selected.size, total: parts.length })}</span>
        </div>
        <div className="max-h-[320px] overflow-auto border border-border">
          <Table dense>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label={t.selectAll}
                    checked={allSelected}
                    onChange={(event) => (event.target.checked ? selectAll() : selectNone())}
                  />
                </Th>
                <Th>{t.columns.part}</Th>
                <Th>{t.columns.current}</Th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <input id={`${id}-${p.id}`} type="checkbox" className="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </Td>
                  <Td>
                    <label htmlFor={`${id}-${p.id}`} className="font-bold">
                      {p.name}
                    </label>
                  </Td>
                  <Td muted={!p.materialCode}>{current(p)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t.material} htmlFor={`${id}-m`}>
            <Select id={`${id}-m`} dense value={material} onChange={(event) => setMaterial(event.target.value)}>
              <option value={KEEP}>{t.keepMaterial}</option>
              {materials.map((m) => (
                <option key={m.code} value={m.code} disabled={m.notBenchmarked}>
                  {m.code} — {m.name}
                  {m.notBenchmarked ? ` — ${c.upload.part.material.notBenchmarked}` : ""}
                </option>
              ))}
              <option value={CLEAR}>{t.clearMaterial}</option>
            </Select>
          </Field>
          <Field label={t.thickness} htmlFor={`${id}-t`} help={market && choice ? c.upload.part.material.benchmarkedHint : t.thicknessHelp}>
            <ThicknessInput id={`${id}-t`} value={thickness} onValueChange={setThickness} choice={choice} market={market && choice !== null} emptyLabel={t.keepThickness} />
          </Field>
        </div>
        {!canApply && !pending && <p className="mt-3 text-[12px] text-text-faint">{t.nothingToApply}</p>}
      </Modal>
    </>
  );
}
