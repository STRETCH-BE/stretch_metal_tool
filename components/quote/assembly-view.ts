/**
 * Assembly editor view helpers — pure derivations shared by
 * components/quote/assembly-editor.tsx, assembly-cost-panel.tsx and
 * forming-editor.tsx: members / loose items of a bundle, the order
 * quantity of a member, the effective (inherited) material, the DC01 →
 * S235 note rule, matching a forming flag to the operation it describes
 * and summarising a forming operation for its chip. Unit tested in
 * test/ui/assembly-view.test.ts.
 * File path: /components/quote/assembly-view.ts
 *
 * Nothing here prices anything: the numbers shown come from
 * PricedAssembly (server snapshot or the local preview). The forming
 * flag → operation match compares kind + geometry numbers because the
 * engine's forming flags carry no operation id (contract request noted
 * in docs/assembly-mode-notes/ui.md).
 */

import type { AssemblyRow, PartRow, QuoteItemRow } from "@/lib/db/types";
import type { Flag, FormingOperation, OperationLine, PricedAssembly } from "@/lib/pricing/types";
import { OPERATION_LABELS } from "@/lib/pricing/labels";
import { parseForming } from "@/lib/quotes/schema";

export type MemberView = {
  item: QuoteItemRow;
  part: PartRow | null;
  qtyPerAssembly: number;
  orderQty: number;
  /** Material / thickness actually priced: the part's own when set (or overridden), else the assembly's. */
  materialCode: string | null;
  thicknessMm: number | null;
  /** The part's own material differs from the assembly's (shown as "differs" / drives the override checkbox). */
  differs: boolean;
  forming: FormingOperation[];
};

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function memberItems(items: ReadonlyArray<QuoteItemRow>, assemblyId: string): QuoteItemRow[] {
  return items.filter((i) => i.assembly_id === assemblyId).sort((a, b) => a.position - b.position);
}

/** Items that belong to no assembly of the quote (an orphaned assembly_id counts as loose, like the mapper). */
export function looseItems(items: ReadonlyArray<QuoteItemRow>, assemblies: ReadonlyArray<AssemblyRow>): QuoteItemRow[] {
  const ids = new Set(assemblies.map((a) => a.id));
  return items.filter((i) => !i.assembly_id || !ids.has(i.assembly_id));
}

/** Ids of every item that is a member of an assembly of the quote (hidden from the loose table). */
export function memberItemIds(items: ReadonlyArray<QuoteItemRow>, assemblies: ReadonlyArray<AssemblyRow>): Set<string> {
  const ids = new Set(assemblies.map((a) => a.id));
  return new Set(items.filter((i) => i.assembly_id && ids.has(i.assembly_id)).map((i) => i.id));
}

export function orderQty(assembly: Pick<AssemblyRow, "qty">, item: Pick<QuoteItemRow, "qty_per_assembly">): number {
  return Math.max(1, Math.round(num(assembly.qty) ?? 1)) * Math.max(1, Math.round(num(item.qty_per_assembly) ?? 1));
}

function sameCode(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function memberView(item: QuoteItemRow, part: PartRow | null, assembly: AssemblyRow): MemberView {
  const ownMaterial = part?.material_code ?? null;
  const ownThickness = num(part?.thickness_mm);
  const assemblyMaterial = assembly.material_code ?? null;
  const assemblyThickness = num(assembly.thickness_mm);
  const differs =
    (ownMaterial !== null && assemblyMaterial !== null && !sameCode(ownMaterial, assemblyMaterial)) ||
    (ownThickness !== null && assemblyThickness !== null && Math.abs(ownThickness - assemblyThickness) > 1e-6);
  return {
    item,
    part,
    qtyPerAssembly: Math.max(1, Math.round(num(item.qty_per_assembly) ?? 1)),
    orderQty: orderQty(assembly, item),
    materialCode: ownMaterial ?? assemblyMaterial,
    thicknessMm: ownThickness ?? assemblyThickness,
    differs,
    forming: parseForming(item.forming),
  };
}

const S235 = /^s235/i;
const DC01 = /^dc01/i;

/** The material note is mandatory when DC01 is quoted where the assembly says S235 (design §3 "Material consistency"). */
export function materialNoteRequired(assemblyMaterial: string | null, memberMaterial: string | null): boolean {
  return Boolean(assemblyMaterial && memberMaterial && S235.test(assemblyMaterial.trim()) && DC01.test(memberMaterial.trim()));
}

/** Flags of the bundle / preview that concern this item (or its part). */
export function flagsForItem(flags: ReadonlyArray<Flag>, itemId: string, partId: string | null): Flag[] {
  return flags.filter((f) => f.itemId === itemId || (f.itemId === null && partId !== null && f.partId === partId));
}

function close(a: unknown, b: number): boolean {
  return typeof a === "number" && Math.abs(a - b) < 1e-6;
}

/** True when a forming.* flag describes this operation (kind + geometry numbers — the flags carry no operation id). */
export function flagMatchesOperation(flag: Pick<Flag, "code" | "params">, op: FormingOperation): boolean {
  if (!flag.code.startsWith("forming.")) return false;
  const p = flag.params;
  if (p.kind !== op.kind) return false;
  if (op.kind === "roll") return close(p.radiusMm, op.insideRadiusMm) && close(p.angleDeg, op.angleDeg) && close(p.widthMm, op.widthMm);
  return close(p.bends, op.bends) && close(p.angleDeg, op.angleDeg) && close(p.lengthMm, op.lengthMm);
}

/** The red forming.not_feasible flag of this operation, if any. */
export function notFeasibleFlag(flags: ReadonlyArray<Flag>, op: FormingOperation): Flag | null {
  return flags.find((f) => f.code === "forming.not_feasible" && flagMatchesOperation(f, op)) ?? null;
}

/** "R90 × 180° × 247" / "2 × 90° × 375" for the forming chip (numbers pre-formatted by the caller). */
export function formingSummary(op: FormingOperation, fmt: (n: number) => string): string {
  return op.kind === "roll"
    ? `R${fmt(op.insideRadiusMm)} × ${fmt(op.angleDeg)}° × ${fmt(op.widthMm)}`
    : `${fmt(op.bends)} × ${fmt(op.angleDeg)}° × ${fmt(op.lengthMm)}`;
}

let formingSeq = 0;

/** Client-side id for a new operation (the server keeps / regenerates ids on save). */
export function newFormingId(): string {
  formingSeq += 1;
  return `f-${Date.now().toString(36)}-${formingSeq}`;
}

/* ─── Cost panel rows (admin) ─────────────────────────────── */

export type LabourKind = "fitup" | "tack" | "weld" | "gasWire" | "deburr" | "handling" | "forming";

const LABOUR_LABELS: Record<string, LabourKind> = {
  [OPERATION_LABELS.assemblyFitup]: "fitup",
  [OPERATION_LABELS.assemblyTack]: "tack",
  [OPERATION_LABELS.assemblyWeld]: "weld",
  [OPERATION_LABELS.assemblyGasWire]: "gasWire",
  [OPERATION_LABELS.assemblyDeburr]: "deburr",
  [OPERATION_LABELS.assemblyHandling]: "handling",
  [OPERATION_LABELS.stepBend]: "forming",
  [OPERATION_LABELS.rollForming]: "forming",
};

export type AssemblyCostGroups = {
  partsAtCost: OperationLine[];
  /** One row per labour kind in display order with minutes and EUR summed. */
  labour: { kind: LabourKind; minutes: number; eur: number }[];
  setups: OperationLine[];
  subcontract: OperationLine[];
  other: OperationLine[];
  partsEur: number;
  labourEur: number;
  setupsEur: number;
  subcontractEur: number;
};

const LABOUR_ORDER: LabourKind[] = ["fitup", "tack", "weld", "gasWire", "deburr", "handling", "forming"];

function minutesOf(line: OperationLine): number {
  const m = line.details.minutes;
  return typeof m === "number" && Number.isFinite(m) ? m : 0;
}

/** Splits PricedAssembly.operations into the panel's groups (per assembly piece — unitCost is already per piece). */
export function groupAssemblyCosts(priced: Pick<PricedAssembly, "operations">): AssemblyCostGroups {
  const partsAtCost: OperationLine[] = [];
  const setups: OperationLine[] = [];
  const subcontract: OperationLine[] = [];
  const other: OperationLine[] = [];
  const labour = new Map<LabourKind, { minutes: number; eur: number }>();
  for (const line of priced.operations) {
    if (line.label === OPERATION_LABELS.assemblyParts) partsAtCost.push(line);
    else if (line.type === "setup") setups.push(line);
    else if (line.label === OPERATION_LABELS.subcontractForming) subcontract.push(line);
    else if (LABOUR_LABELS[line.label]) {
      const kind = LABOUR_LABELS[line.label];
      const acc = labour.get(kind) ?? { minutes: 0, eur: 0 };
      acc.minutes += minutesOf(line);
      acc.eur += line.unitCost;
      labour.set(kind, acc);
    } else other.push(line);
  }
  const sum = (lines: OperationLine[]) => lines.reduce((s, l) => s + l.unitCost, 0);
  const labourRows = LABOUR_ORDER.filter((k) => labour.has(k)).map((kind) => ({ kind, ...labour.get(kind)! }));
  return {
    partsAtCost,
    labour: labourRows,
    setups,
    subcontract,
    other,
    partsEur: sum(partsAtCost),
    labourEur: labourRows.reduce((s, r) => s + r.eur, 0),
    setupsEur: sum(setups),
    subcontractEur: sum(subcontract),
  };
}
