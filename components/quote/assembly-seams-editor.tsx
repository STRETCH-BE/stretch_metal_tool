"use client";

/**
 * AssemblySeamsEditor — the seams of one welded assembly: label, part,
 * length, process, thickness at the joint, type (continuous / stitch
 * with bead + pitch / tack with a count), sides, and whether the seam is
 * counted — a seam stored as the neighbour's edge of an already-marked
 * joint (paired_seam_id) is greyed "= edge of …" and not counted, with
 * "count separately" to undo a wrong pairing. Running totals per process
 * and the counted total come from lib/quotes/seams.ts seamTotals.
 * File path: /components/quote/assembly-seams-editor.tsx
 *
 * One inline form (add or edit) at a time; every save is a server action
 * (addSeam / updateSeam / removeSeam / unpairSeam) so the seam ids the
 * viewer's hand-off compares against are always the server's. addSeam
 * from here is never paired (contract) — the viewer's addSeamFromPart is.
 */

import { useState } from "react";
import { useContent } from "@/components/providers/locale";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Select } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import type { AssemblyRow, AssemblySeamRow, PartRow, WeldProcessDb } from "@/lib/db/types";
import { formatNumber, interpolate } from "@/lib/format";
import { addSeam, removeSeam, unpairSeam, updateSeam } from "@/lib/quotes/actions";
import { SEAM_TYPES, WELD_PROCESSES, type SeamInput } from "@/lib/quotes/schema";
import { seamTotals } from "@/lib/quotes/seams";
import type { ActionRunner } from "./action-runner";

export type AssemblySeamsEditorProps = {
  assembly: AssemblyRow;
  seams: AssemblySeamRow[];
  /** Member parts (for the part select and the names). */
  memberParts: PartRow[];
  partsById: ReadonlyMap<string, PartRow>;
  editable: boolean;
  pending: boolean;
  act: ActionRunner;
};

type SeamForm = {
  label: string;
  partId: string;
  lengthMm: number;
  process: WeldProcessDb;
  thicknessMm: number | null;
  seamType: "continuous" | "stitch" | "tack";
  stitchBeadMm: number;
  stitchPitchMm: number;
  tackCount: number;
  sides: 1 | 2;
};

function num(value: number | string | null | undefined, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function emptyForm(): SeamForm {
  return { label: "", partId: "", lengthMm: 100, process: "mig_mag", thicknessMm: null, seamType: "continuous", stitchBeadMm: 30, stitchPitchMm: 60, tackCount: 4, sides: 1 }; // [CONFIRM] seam defaults
}

function formFromRow(row: AssemblySeamRow): SeamForm {
  return {
    label: row.label ?? "",
    partId: row.part_id ?? "",
    lengthMm: num(row.length_mm),
    process: row.process,
    thicknessMm: row.thickness_mm === null ? null : num(row.thickness_mm),
    seamType: row.seam_type,
    stitchBeadMm: num(row.stitch_bead_mm, 30),
    stitchPitchMm: num(row.stitch_pitch_mm, 60),
    tackCount: num(row.tack_count, 4),
    sides: num(row.sides) === 2 ? 2 : 1,
  };
}

function formToInput(form: SeamForm): SeamInput {
  return {
    label: form.label.trim() === "" ? null : form.label.trim(),
    partId: form.partId || null,
    lengthMm: form.lengthMm,
    process: form.process,
    thicknessMm: form.thicknessMm,
    seamType: form.seamType,
    stitchBeadMm: form.seamType === "stitch" ? form.stitchBeadMm : null,
    stitchPitchMm: form.seamType === "stitch" ? form.stitchPitchMm : null,
    tackCount: form.seamType === "tack" ? Math.max(0, Math.round(form.tackCount)) : null,
    sides: form.sides,
  };
}

function formValid(form: SeamForm): boolean {
  if (!Number.isFinite(form.lengthMm) || form.lengthMm < 0) return false;
  if (form.seamType === "stitch" && (form.stitchBeadMm <= 0 || form.stitchPitchMm <= 0)) return false;
  if (form.seamType === "tack" && form.tackCount < 0) return false;
  return true;
}

export function AssemblySeamsEditor({ assembly, seams, memberParts, partsById, editable, pending, act }: AssemblySeamsEditorProps) {
  const c = useContent();
  const t = c.quote.builder.assembly.seams;
  const processes = c.quote.builder.welding.processes;
  const [editing, setEditing] = useState<{ id: string | null; form: SeamForm } | null>(null);
  const seamsById = new Map(seams.map((s) => [s.id, s]));
  const totals = seamTotals(seams, assembly.thickness_mm === null ? null : num(assembly.thickness_mm));
  const fmt = (n: number, digits = 0) => formatNumber(n, c.locale, { maximumFractionDigits: digits });

  const partName = (partId: string | null) => (partId ? (partsById.get(partId)?.name ?? "—") : t.byHand);
  const pairedLabel = (seam: AssemblySeamRow) => {
    const partner = seam.paired_seam_id ? seamsById.get(seam.paired_seam_id) : null;
    const name = partner?.part_id ? partsById.get(partner.part_id)?.name : null;
    return name ? interpolate(t.paired, { name }) : t.pairedUnknown;
  };

  const startAdd = () => setEditing({ id: null, form: { ...emptyForm(), label: interpolate(t.defaultLabel, { n: seams.length + 1 }) } });
  const startEdit = (seam: AssemblySeamRow) => setEditing({ id: seam.id, form: formFromRow(seam) });
  const patchForm = (patch: Partial<SeamForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const saveForm = () => {
    if (!editing || !formValid(editing.form)) return;
    const input = formToInput(editing.form);
    if (editing.id === null) act(() => addSeam(assembly.id, input), (r) => (r.pairedSeamId ? t.addedPaired : t.added));
    else act(() => updateSeam(editing.id!, input), t.saved);
    setEditing(null);
  };

  const form = editing?.form ?? null;

  return (
    <div className="flex flex-col gap-3">
      <TableWrap>
        <Table dense>
          <thead>
            <tr>
              <Th>{t.columns.label}</Th>
              <Th>{t.columns.part}</Th>
              <Th align="num">{t.columns.length}</Th>
              <Th>{t.columns.process}</Th>
              <Th align="num">{t.columns.thickness}</Th>
              <Th>{t.columns.type}</Th>
              <Th>{t.columns.pattern}</Th>
              <Th align="num">{t.columns.sides}</Th>
              <Th>{t.columns.counted}</Th>
              {editable && <Th>{c.common.table.actions}</Th>}
            </tr>
          </thead>
          <tbody>
            {seams.length === 0 && (
              <tr className="row-muted">
                <Td colSpan={editable ? 10 : 9} className="py-5 text-center">
                  {t.empty}
                </Td>
              </tr>
            )}
            {seams.map((seam) => {
              const paired = seam.paired_seam_id !== null;
              return (
                <tr key={seam.id} className={paired ? "row-muted" : undefined}>
                  <Td>{seam.label ?? "—"}</Td>
                  <Td muted={!seam.part_id}>{partName(seam.part_id)}</Td>
                  <Td align="num">{fmt(num(seam.length_mm), 1)}</Td>
                  <Td>{processes[seam.process]}</Td>
                  <Td align="num" muted={seam.thickness_mm === null}>
                    {seam.thickness_mm === null ? t.thicknessInherited : fmt(num(seam.thickness_mm), 2)}
                  </Td>
                  <Td>{t.types[seam.seam_type]}</Td>
                  <Td muted>
                    {seam.seam_type === "stitch" && interpolate(t.stitchInfo, { bead: fmt(num(seam.stitch_bead_mm)), pitch: fmt(num(seam.stitch_pitch_mm)) })}
                    {seam.seam_type === "tack" && interpolate(t.tackInfo, { count: fmt(num(seam.tack_count)) })}
                    {seam.seam_type === "continuous" && "—"}
                  </Td>
                  <Td align="num">{num(seam.sides) === 2 ? 2 : 1}</Td>
                  <Td>
                    {paired ? (
                      <span className="inline-flex flex-wrap items-center gap-2 text-text-faint">
                        <span>{pairedLabel(seam)}</span>
                        <span className="text-[11px] uppercase tracking-[0.08em]">{t.notCounted}</span>
                        {editable && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => unpairSeam(seam.id), t.unpaired)}>
                            {t.unpair}
                          </button>
                        )}
                      </span>
                    ) : (
                      t.countedYes
                    )}
                  </Td>
                  {editable && (
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => startEdit(seam)}>
                          {t.edit}
                        </button>
                        <ConfirmButton action={() => Promise.resolve(act(() => removeSeam(seam.id), t.removed))} disabled={pending}>
                          {t.remove}
                        </ConfirmButton>
                      </span>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <Td colSpan={2}>
                <span className="font-bold">{t.totals.title}</span>
                <span className="ml-2 text-text-muted">
                  {t.totals.counted}: {totals.counted}
                  {totals.paired > 0 && ` · ${totals.paired} ${t.totals.paired}`}
                </span>
              </Td>
              <Td align="num" className="font-bold">
                {fmt(totals.lengthMm)}
              </Td>
              <Td colSpan={editable ? 7 : 6}>
                <span className="text-text-muted">
                  {t.totals.effective}: {fmt(totals.effectiveLengthMm)} {c.common.units.mm}
                  {totals.tackCount > 0 && ` · ${t.totals.tacks}: ${totals.tackCount}`}
                </span>
              </Td>
            </tr>
            {totals.byProcess.map((group) => (
              <tr key={`${group.process}-${group.thicknessMm ?? "a"}`} className="row-muted">
                <Td colSpan={2} className="pl-6">
                  {group.thicknessMm === null
                    ? interpolate(t.totals.groupNoThickness, { process: processes[group.process] })
                    : interpolate(t.totals.group, { process: processes[group.process], thickness: fmt(group.thicknessMm, 2) })}
                </Td>
                <Td align="num">{fmt(group.lengthMm)}</Td>
                <Td colSpan={editable ? 7 : 6}>
                  {t.totals.effective}: {fmt(group.effectiveLengthMm)} {c.common.units.mm} · {group.seams}
                </Td>
              </tr>
            ))}
          </tfoot>
        </Table>
      </TableWrap>

      {editable && !form && (
        <div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={startAdd}>
            {t.add}
          </button>
        </div>
      )}

      {editable && form && (
        <form
          className="flex flex-wrap items-end gap-3 border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveForm();
          }}
        >
          <Field label={t.columns.label} htmlFor={`seam-${assembly.id}-label`}>
            <Input id={`seam-${assembly.id}-label`} dense inline className="w-[140px]" value={form.label} maxLength={120} onChange={(e) => patchForm({ label: e.target.value })} />
          </Field>
          <Field label={t.columns.part} htmlFor={`seam-${assembly.id}-part`}>
            <Select id={`seam-${assembly.id}-part`} dense inline value={form.partId} onChange={(e) => patchForm({ partId: e.target.value })}>
              <option value="">{t.byHand}</option>
              {memberParts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.columns.length} htmlFor={`seam-${assembly.id}-length`}>
            <NumberInput id={`seam-${assembly.id}-length`} dense inline className="w-[100px]" value={form.lengthMm} decimals={1} min={0} onValueChange={(v) => v !== null && patchForm({ lengthMm: v })} />
          </Field>
          <Field label={t.columns.process} htmlFor={`seam-${assembly.id}-process`}>
            <Select id={`seam-${assembly.id}-process`} dense inline value={form.process} onChange={(e) => patchForm({ process: e.target.value as WeldProcessDb })}>
              {WELD_PROCESSES.map((p) => (
                <option key={p} value={p}>
                  {processes[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.columns.thickness} htmlFor={`seam-${assembly.id}-thickness`} help={form.thicknessMm === null ? t.thicknessInherited : undefined}>
            <NumberInput id={`seam-${assembly.id}-thickness`} dense inline className="w-[80px]" value={form.thicknessMm} decimals={2} min={0.01} onValueChange={(v) => patchForm({ thicknessMm: v })} />
          </Field>
          <Field label={t.columns.type} htmlFor={`seam-${assembly.id}-type`}>
            <Select id={`seam-${assembly.id}-type`} dense inline value={form.seamType} onChange={(e) => patchForm({ seamType: e.target.value as SeamForm["seamType"] })}>
              {SEAM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t.types[type]}
                </option>
              ))}
            </Select>
          </Field>
          {form.seamType === "stitch" && (
            <>
              <Field label={t.beadMm} htmlFor={`seam-${assembly.id}-bead`}>
                <NumberInput id={`seam-${assembly.id}-bead`} dense inline className="w-[80px]" value={form.stitchBeadMm} decimals={1} min={0.1} onValueChange={(v) => v !== null && patchForm({ stitchBeadMm: v })} />
              </Field>
              <Field label={t.pitchMm} htmlFor={`seam-${assembly.id}-pitch`}>
                <NumberInput id={`seam-${assembly.id}-pitch`} dense inline className="w-[80px]" value={form.stitchPitchMm} decimals={1} min={0.1} onValueChange={(v) => v !== null && patchForm({ stitchPitchMm: v })} />
              </Field>
            </>
          )}
          {form.seamType === "tack" && (
            <Field label={t.tackCount} htmlFor={`seam-${assembly.id}-tacks`}>
              <NumberInput id={`seam-${assembly.id}-tacks`} dense inline className="w-[80px]" value={form.tackCount} decimals={0} min={0} onValueChange={(v) => v !== null && patchForm({ tackCount: Math.max(0, Math.round(v)) })} />
            </Field>
          )}
          <Field label={t.columns.sides} htmlFor={`seam-${assembly.id}-sides`}>
            <Select id={`seam-${assembly.id}-sides`} dense inline value={String(form.sides)} onChange={(e) => patchForm({ sides: e.target.value === "2" ? 2 : 1 })}>
              <option value="1">1</option>
              <option value="2">2</option>
            </Select>
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !formValid(form)}>
              {t.save}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setEditing(null)}>
              {t.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
