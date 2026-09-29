"use client";

/**
 * AssemblyEditor — the welded assemblies of a quote (docs/assembly-mode-
 * design.md §5). Per assembly: name, drawing reference, quantity,
 * material + thickness (inherited by the members), notes; the members
 * table (part, pieces per assembly, order qty = assembly qty × pieces,
 * effective material / thickness with the "differs" marker, forming
 * chips, remove); the material override + note for a member whose
 * material differs (the note is mandatory when DC01 replaces S235); a
 * picker to move loose items in; the seams editor; the forming editor
 * per member; and the cost / margin / price panel (full breakdown for
 * admins, unit price + total for everyone else).
 * File path: /components/quote/assembly-editor.tsx
 *
 * Every mutation is a server action (createAssembly / updateAssembly /
 * removeAssembly / setItemAssembly / setItemMaterialOverride and the
 * seam / forming actions in the child editors) run through the builder's
 * ActionRunner — the server re-prices and the refreshed bundle replaces
 * the local form state. Prices shown come from `priced` (server snapshot
 * or the local preview); the assembly flags (quote-level flags carrying
 * params.assemblyId) are listed on the card, member flags in the members
 * table.
 */

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { NumberInput } from "@/components/ui/number-input";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import type { AssemblyRow, PartRow, QuoteItemRow } from "@/lib/db/types";
import { formatNumber } from "@/lib/format";
import { materialChoicesFromSnapshot } from "@/lib/parts/material-choices";
import type { Flag, PricedQuote, RateSnapshot } from "@/lib/pricing/types";
import { removeAssembly, setItemAssembly, setItemMaterialOverride, updateAssembly } from "@/lib/quotes/actions";
import type { AssemblyInput } from "@/lib/quotes/schema";
import type { QuoteBundle } from "@/lib/quotes/types";
import { routes } from "@/lib/routes";
import type { ActionRunner } from "./action-runner";
import { AssemblyCostPanel } from "./assembly-cost-panel";
import { AssemblySeamsEditor } from "./assembly-seams-editor";
import { flagsForItem, formingSummary, looseItems, materialNoteRequired, memberItems, memberView, type MemberView } from "./assembly-view";
import { FlagChip } from "./flag-message";
import { FormingEditor } from "./forming-editor";
import type { MoneyFormatter } from "./money";

export type AssemblyEditorProps = {
  bundle: QuoteBundle;
  priced: PricedQuote | null;
  rates: RateSnapshot | null;
  editable: boolean;
  pending: boolean;
  isAdmin: boolean;
  money: MoneyFormatter;
  act: ActionRunner;
};

type AssemblyForm = { name: string; drawingRef: string; qty: number; materialCode: string; thicknessMm: number | null; notes: string };

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formFromRow(row: AssemblyRow): AssemblyForm {
  return {
    name: row.name,
    drawingRef: row.drawing_ref ?? "",
    qty: Math.max(1, Math.round(num(row.qty) ?? 1)),
    materialCode: row.material_code ?? "",
    thicknessMm: num(row.thickness_mm),
    notes: row.notes ?? "",
  };
}

function formToInput(form: AssemblyForm): AssemblyInput {
  return {
    name: form.name.trim(),
    drawingRef: form.drawingRef.trim() === "" ? null : form.drawingRef.trim(),
    qty: Math.max(1, Math.round(form.qty)),
    materialCode: form.materialCode.trim() === "" ? null : form.materialCode.trim(),
    thicknessMm: form.thicknessMm !== null && form.thicknessMm > 0 ? form.thicknessMm : null,
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
  };
}

export function AssemblyEditor({ bundle, priced, rates, editable, pending, isAdmin, money, act }: AssemblyEditorProps) {
  const c = useContent();
  const t = c.quote.builder.assembly;
  const partsById = new Map(bundle.parts.map((p) => [p.id, p]));
  const flags = priced?.flags ?? bundle.flags;
  const loose = looseItems(bundle.items, bundle.assemblies);
  const materials = materialChoicesFromSnapshot(rates);

  if (bundle.assemblies.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="font-bold">{t.empty}</p>
        <p className="mt-1 text-[13px] text-text-muted">{t.emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {bundle.assemblies.map((assembly, index) => (
        <AssemblyCard
          key={assembly.id}
          index={index}
          assembly={assembly}
          members={memberItems(bundle.items, assembly.id).map((item) => memberView(item, partsById.get(item.part_id) ?? null, assembly))}
          loose={loose}
          partsById={partsById}
          seams={bundle.seams.filter((s) => s.assembly_id === assembly.id)}
          priced={priced}
          flags={flags}
          materials={materials.map((m) => ({ code: m.code, name: m.name }))}
          editable={editable}
          pending={pending}
          isAdmin={isAdmin}
          money={money}
          act={act}
        />
      ))}
    </div>
  );
}

type AssemblyCardProps = {
  index: number;
  assembly: AssemblyRow;
  members: MemberView[];
  loose: QuoteItemRow[];
  partsById: ReadonlyMap<string, PartRow>;
  seams: QuoteBundle["seams"];
  priced: PricedQuote | null;
  flags: Flag[];
  materials: { code: string; name: string }[];
  editable: boolean;
  pending: boolean;
  isAdmin: boolean;
  money: MoneyFormatter;
  act: ActionRunner;
};

function AssemblyCard({ index, assembly, members, loose, partsById, seams, priced, flags, materials, editable, pending, isAdmin, money, act }: AssemblyCardProps) {
  const c = useContent();
  const t = c.quote.builder.assembly;
  const f = c.quote.builder.forming;
  const rowKey = JSON.stringify(assembly);
  const [form, setForm] = useState<AssemblyForm>(() => formFromRow(assembly));
  const [pickId, setPickId] = useState("");
  const [pickQty, setPickQty] = useState(1);
  const [openForming, setOpenForming] = useState<Record<string, boolean>>({});
  const [materialDrafts, setMaterialDrafts] = useState<Record<string, { override: boolean; note: string }>>({});
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, number>>({});

  useEffect(() => {
    setForm(formFromRow(assembly));
    setQtyDrafts({});
    setMaterialDrafts({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);
  useEffect(() => {
    if (pickId && !loose.some((i) => i.id === pickId)) setPickId("");
  }, [loose, pickId]);

  const dirty = JSON.stringify(form) !== JSON.stringify(formFromRow(assembly));
  const pricedAssembly = priced?.assemblies.find((a) => a.assemblyId === assembly.id) ?? null;
  const assemblyFlags = flags.filter((fl) => fl.itemId === null && fl.partId === null && fl.params.assemblyId === assembly.id);
  const fmt = (n: number, digits = 1) => formatNumber(n, c.locale, { maximumFractionDigits: digits });
  const qty = Math.max(1, Math.round(num(assembly.qty) ?? 1));
  const materialListed = form.materialCode === "" || materials.some((m) => m.code === form.materialCode);

  const materialDraft = (m: MemberView) => materialDrafts[m.item.id] ?? { override: m.item.material_override, note: m.item.material_note ?? "" };
  const patchMaterial = (m: MemberView, patch: Partial<{ override: boolean; note: string }>) =>
    setMaterialDrafts((d) => ({ ...d, [m.item.id]: { ...materialDraft(m), ...patch } }));

  return (
    <section aria-label={assembly.name} className="flex flex-col gap-4 px-4 py-4">
      {/* Head: name + chips + price */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-faint">{index + 1}</span>
            <span className="h2-sm">{assembly.name}</span>
            {assembly.drawing_ref && <span className="mono text-[12px] text-text-muted">{assembly.drawing_ref}</span>}
            {assemblyFlags.map((flag, i) => (
              <FlagChip key={`${flag.code}-${i}`} content={c} flag={flag} />
            ))}
          </div>
        </div>
        {!isAdmin && <AssemblyCostPanel priced={pricedAssembly} qty={qty} isAdmin={false} money={money} />}
      </div>

      {/* Assembly form */}
      <fieldset disabled={!editable || pending} className="grid gap-3 md:grid-cols-6">
        <Field label={t.fields.name} htmlFor={`asm-${assembly.id}-name`} className="md:col-span-2">
          <Input id={`asm-${assembly.id}-name`} dense value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t.fields.drawingRef} htmlFor={`asm-${assembly.id}-ref`}>
          <Input id={`asm-${assembly.id}-ref`} dense className="mono" value={form.drawingRef} maxLength={120} onChange={(e) => setForm({ ...form, drawingRef: e.target.value })} />
        </Field>
        <Field label={t.fields.qty} htmlFor={`asm-${assembly.id}-qty`}>
          <NumberInput id={`asm-${assembly.id}-qty`} dense value={form.qty} decimals={0} min={1} onValueChange={(v) => v !== null && setForm({ ...form, qty: Math.max(1, Math.round(v)) })} />
        </Field>
        <Field label={t.fields.material} htmlFor={`asm-${assembly.id}-mat`}>
          <Select id={`asm-${assembly.id}-mat`} dense value={form.materialCode} onChange={(e) => setForm({ ...form, materialCode: e.target.value })}>
            <option value="">{t.fields.materialNone}</option>
            {!materialListed && <option value={form.materialCode}>{form.materialCode}</option>}
            {materials.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} — {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.fields.thickness} htmlFor={`asm-${assembly.id}-t`}>
          <NumberInput id={`asm-${assembly.id}-t`} dense value={form.thicknessMm} decimals={2} min={0.01} onValueChange={(v) => setForm({ ...form, thicknessMm: v })} />
        </Field>
        <Field label={t.fields.notes} htmlFor={`asm-${assembly.id}-notes`} className="md:col-span-4">
          <Textarea id={`asm-${assembly.id}-notes`} dense rows={1} value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {editable && (
          <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-2">
            <ConfirmButton action={() => Promise.resolve(act(() => removeAssembly(assembly.id), t.removed))} question={t.removeConfirm} disabled={pending}>
              {t.remove}
            </ConfirmButton>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending || !dirty || form.name.trim().length === 0} onClick={() => act(() => updateAssembly(assembly.id, formToInput(form)), t.saved)}>
              {t.save}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </button>
          </div>
        )}
      </fieldset>

      {/* Members */}
      <div>
        <div className="panel-title mb-2">{t.members.title}</div>
        <TableWrap>
          <Table dense>
            <thead>
              <tr>
                <Th>{t.members.columns.part}</Th>
                <Th align="num">{t.members.columns.qtyPerAssembly}</Th>
                <Th align="num">{t.members.columns.orderQty}</Th>
                <Th>{t.members.columns.material}</Th>
                <Th align="num">{t.members.columns.thickness}</Th>
                <Th>{t.members.columns.forming}</Th>
                <Th>{c.quote.builder.parts.columns.flags}</Th>
                {editable && <Th>{c.common.table.actions}</Th>}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr className="row-muted">
                  <Td colSpan={editable ? 8 : 7} className="py-5 text-center">
                    {t.members.empty}
                  </Td>
                </tr>
              )}
              {members.map((m) => {
                const itemFlags = flagsForItem(flags, m.item.id, m.part?.id ?? null);
                const formingOpen = Boolean(openForming[m.item.id]);
                const draft = materialDraft(m);
                const noteRequired = materialNoteRequired(assembly.material_code, m.part?.material_code ?? null);
                const showMaterialRow = editable && (m.differs || m.item.material_override || noteRequired);
                const materialDirty = draft.override !== m.item.material_override || draft.note !== (m.item.material_note ?? "");
                return (
                  <Fragment key={m.item.id}>
                    <tr>
                      <Td>
                        {m.part ? (
                          <Link href={routes.part(m.part.id)} className="lnk font-bold">
                            {m.part.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td align="num">
                        {editable ? (
                          <NumberInput
                            aria-label={t.members.columns.qtyPerAssembly}
                            dense
                            inline
                            className="w-[76px]"
                            value={qtyDrafts[m.item.id] ?? m.qtyPerAssembly}
                            decimals={0}
                            min={1}
                            disabled={pending}
                            onValueChange={(v) => v !== null && v >= 1 && setQtyDrafts((d) => ({ ...d, [m.item.id]: Math.round(v) }))}
                            onBlur={() => {
                              const value = qtyDrafts[m.item.id];
                              if (value !== undefined && value !== m.qtyPerAssembly) {
                                act(() => setItemAssembly(m.item.id, { assemblyId: assembly.id, qtyPerAssembly: value }), c.common.actions.saved);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                            }}
                          />
                        ) : (
                          fmt(m.qtyPerAssembly, 0)
                        )}
                      </Td>
                      <Td align="num">{fmt(m.orderQty, 0)}</Td>
                      <Td>
                        <span className="mono">{m.materialCode ?? "—"}</span>
                        {m.part?.material_code === null && assembly.material_code && <span className="ml-2 text-[11px] uppercase text-text-faint">{t.members.inherited}</span>}
                        {m.differs && <StatusChip severity={m.item.material_override ? "neutral" : "amber"} plain label={t.members.differs} className="ml-2" />}
                      </Td>
                      <Td align="num">{m.thicknessMm !== null ? `${fmt(m.thicknessMm, 2)} ${c.common.units.mm}` : "—"}</Td>
                      <Td>
                        <span className="inline-flex flex-wrap items-center gap-1">
                          {m.forming.map((op) => (
                            <StatusChip
                              key={op.id}
                              severity="neutral"
                              plain
                              label={op.resolution?.kind === "none_needed" ? f.noneNeeded : `${f.kinds[op.kind]} ${formingSummary(op, (n) => fmt(n, 1))}`}
                            />
                          ))}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-expanded={formingOpen}
                            aria-controls={`forming-${m.item.id}`}
                            onClick={() => setOpenForming((s) => ({ ...s, [m.item.id]: !formingOpen }))}
                          >
                            {f.title}
                          </button>
                        </span>
                      </Td>
                      <Td>
                        <span className="inline-flex max-w-[240px] flex-wrap gap-1">
                          {itemFlags.map((flag, i) => (
                            <FlagChip key={`${flag.code}-${i}`} content={c} flag={flag} />
                          ))}
                        </span>
                      </Td>
                      {editable && (
                        <Td>
                          <ConfirmButton action={() => Promise.resolve(act(() => setItemAssembly(m.item.id, { assemblyId: null }), t.members.moved))} question={t.members.removeConfirm} disabled={pending}>
                            {t.members.remove}
                          </ConfirmButton>
                        </Td>
                      )}
                    </tr>
                    {showMaterialRow && (
                      <tr>
                        <Td colSpan={editable ? 8 : 7} className="bg-surface">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="flex items-center gap-2 text-[13px]">
                              <input type="checkbox" className="checkbox" checked={draft.override} disabled={pending} onChange={(e) => patchMaterial(m, { override: e.target.checked })} />
                              {t.material.override}
                            </label>
                            <Field
                              label={t.material.note}
                              htmlFor={`mat-note-${m.item.id}`}
                              help={noteRequired ? t.material.noteHelp : t.material.overrideHelp}
                              error={noteRequired && draft.note.trim().length === 0 ? t.material.noteRequired : undefined}
                              className="min-w-[280px] flex-1"
                            >
                              <Input id={`mat-note-${m.item.id}`} dense value={draft.note} maxLength={500} disabled={pending} invalid={noteRequired && draft.note.trim().length === 0} onChange={(e) => patchMaterial(m, { note: e.target.value })} />
                            </Field>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={pending || !materialDirty || (noteRequired && draft.note.trim().length === 0)}
                              onClick={() => act(() => setItemMaterialOverride(m.item.id, { materialOverride: draft.override, materialNote: draft.note.trim() === "" ? null : draft.note.trim() }), t.material.saved)}
                            >
                              {t.material.save}
                              <span aria-hidden="true" className="btn-arrow">
                                →
                              </span>
                            </button>
                          </div>
                        </Td>
                      </tr>
                    )}
                    {formingOpen && (
                      <tr id={`forming-${m.item.id}`}>
                        <Td colSpan={editable ? 8 : 7} className="bg-surface">
                          <div className="panel-title mb-2">
                            {f.title} · {m.part?.name ?? ""}
                          </div>
                          <FormingEditor itemId={m.item.id} forming={m.forming} flags={itemFlags} editable={editable} pending={pending} act={act} />
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>

        {editable && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label={t.members.addPicker} htmlFor={`asm-${assembly.id}-pick`} help={loose.length === 0 ? t.members.addNone : undefined}>
              <Select id={`asm-${assembly.id}-pick`} dense inline value={pickId} disabled={pending || loose.length === 0} onChange={(e) => setPickId(e.target.value)}>
                <option value="">—</option>
                {loose.map((item) => (
                  <option key={item.id} value={item.id}>
                    {partsById.get(item.part_id)?.name ?? item.id}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.members.addQty} htmlFor={`asm-${assembly.id}-pick-qty`}>
              <NumberInput id={`asm-${assembly.id}-pick-qty`} dense inline className="w-[80px]" value={pickQty} decimals={0} min={1} disabled={pending || loose.length === 0} onValueChange={(v) => v !== null && setPickQty(Math.max(1, Math.round(v)))} />
            </Field>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pending || pickId === ""}
              onClick={() => {
                act(() => setItemAssembly(pickId, { assemblyId: assembly.id, qtyPerAssembly: pickQty }), t.members.moved);
                setPickId("");
              }}
            >
              {t.members.add}
            </button>
          </div>
        )}
      </div>

      {/* Seams */}
      <div>
        <div className="panel-title mb-2">{t.seams.title}</div>
        <AssemblySeamsEditor
          assembly={assembly}
          seams={seams}
          memberParts={members.map((m) => m.part).filter((p): p is PartRow => p !== null)}
          partsById={partsById}
          editable={editable}
          pending={pending}
          act={act}
        />
      </div>

      {/* Cost / price */}
      {isAdmin ? (
        <div>
          <div className="panel-title mb-2">{t.cost.title}</div>
          <AssemblyCostPanel priced={pricedAssembly} qty={qty} isAdmin money={money} />
        </div>
      ) : (
        pricedAssembly === null && <Notice tone="info">{t.cost.notPriced}</Notice>
      )}
    </section>
  );
}
