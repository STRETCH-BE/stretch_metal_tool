/**
 * Pricing engine — forming operations (rolling, bending) on a quote item:
 * feasibility against the machine park, the chosen resolution and the
 * labour / subcontract cost that follows (assembly mode,
 * docs/assembly-mode-design.md §3 "Forming").
 * File path: /lib/pricing/forming.ts
 *
 * Feasibility (limits only from MachinePark, never constants):
 *   roll  → RollLimits: insideRadiusMm ≥ minRadiusMm, thickness ≤
 *           maxThicknessMm, widthMm ≤ maxWidthMm; no roll in the park →
 *           not feasible ("no_machine");
 *   bend  → PressBrakeLimits: lengthMm ≤ bendLengthMm and the air-bending
 *           force F = 1.42 × Rm × t² × L / V (formulas.ts bendForceN, the
 *           same rule feasibility.ts applies to bend lines) with V =
 *           dieFactor × t ≤ forceKN; Rm from the material row of the
 *           snapshot given (no snapshot / material → the force rule is
 *           skipped, the length rule still runs); no press brake → not
 *           feasible.
 * Resolution → what is priced:
 *   null or { in_house } on a FEASIBLE op → in house: rolling =
 *           roll_min_per_m × width (m) of labour (label roll_forming),
 *           uses the plate roll (one roll set-up per job); a plain bend op
 *           costs NOTHING extra — the part's bend lines already price the
 *           bends (cost version, per bend) — it only marks the press brake
 *           as used (one press-brake set-up per job);
 *   null on an INFEASIBLE op → red forming.not_feasible, unresolved: the
 *           item / assembly has no price until the user picks a
 *           resolution; { in_house } on an infeasible op is the same red
 *           (physics is not overridable — the admin fixes the limits);
 *   { step_bend, hits } → hits × step_bend_seconds_per_hit of press-brake
 *           labour (label step_bend), amber forming.step_bend, uses the
 *           press brake; suggested hits = ceil(arc ÷ STEP_BEND_PITCH_MM)
 *           with arc = insideRadiusMm × angleDeg × π / 180 (R90 × 180° →
 *           19); 0 or negative hits → treated as unresolved (red);
 *   { subcontract, supplier, costEur, extraLeadDays } → costEur × (1 +
 *           subcontract_margin_pct / 100) per piece (label
 *           subcontract_forming), amber forming.subcontract, extra lead
 *           days reported (the largest over the item's operations);
 *   { none_needed } on an op → the op is ignored (the user confirmed the
 *           drawing's hint was wrong; the confirmation normally lives on
 *           an item without operations, see formingSuspected).
 * Rates (seconds per hit, minutes per metre, the subcontract margin) come
 * only from the JobRates passed in; without them the assessment carries
 * flags and feasibility but no minutes / euros (labourMin 0).
 *
 * formingSuspected(part, forming): the drawing or the annotations say
 * forming (a roll annotation, annotations.forming "rolled" / "bent", a
 * ROLL / BEND-named layer) while the item has no forming operation and no
 * { none_needed } confirmation. Plain bend LINES are deliberately not a
 * hint: the bend model prices them wherever the part is priced (loose
 * lines and members alike), so a bent part with recognised bend lines is
 * known, not "suspected"; a part marked bent WITHOUT bend lines is.
 */

import { bendForceN, defaultDieVMm } from "./formulas";
import { findMaterial, machineOf } from "./lookup";
import { STEP_BEND_PITCH_MM } from "./market-rules";
import type { Flag, FormingOperation, FormingResolution, JobRates, MachinePark, PricingPart, RateSnapshot } from "./types";

const EPS = 1e-9;

export type FormingContext = {
  thicknessMm: number | null;
  materialCode: string | null;
  machines: MachinePark;
  partId: string | null;
  itemId: string | null;
  /** Snapshot for the material's Rm (press-brake force rule); null skips the force rule. */
  rates?: RateSnapshot | null;
  /** Seconds per hit, minutes per metre, subcontract margin; null → flags only, no minutes. */
  jobRates?: Pick<JobRates, "assembly" | "subcontractMarginPct"> | null;
};

export type FormingFeasibility =
  | { feasible: true }
  | { feasible: false; reason: "no_machine" | "min_radius" | "max_thickness" | "max_width" | "bend_length" | "force"; value: number; limit: number };

/** One priced forming operation of the item (the assembly builds the line from it). */
export type FormingCharge =
  | { kind: "roll"; opId: string; widthMm: number; metres: number; minutes: number }
  | { kind: "step_bend"; opId: string; hits: number; minutes: number; radiusMm: number; angleDeg: number }
  | { kind: "subcontract"; opId: string; operation: FormingOperation["kind"]; supplier: string; costEur: number; marginPct: number; pricedEur: number; extraLeadDays: number }
  | { kind: "bend"; opId: string; bends: number; lengthMm: number };

export type FormingAssessment = {
  flags: Flag[];
  /** An infeasible operation without a resolution (or with in_house): no price until resolved. */
  unresolved: boolean;
  /** Press-brake / roll labour minutes per piece (step-bend hits, rolling). */
  labourMin: number;
  /** Subcontracted forming per piece, margin included. */
  subcontractCostEur: number;
  extraLeadDays: number;
  usesPressBrake: boolean;
  usesRoll: boolean;
  charges: FormingCharge[];
};

/** Arc length (mm) of a roll: inside radius × angle. */
export function rollArcLengthMm(op: Extract<FormingOperation, { kind: "roll" }>): number {
  return (op.insideRadiusMm * op.angleDeg * Math.PI) / 180;
}

/** Hits suggested for step-bending a roll: ceil(arc ÷ STEP_BEND_PITCH_MM) — R90 × 180° → 19. */
export function suggestedStepBendHits(op: Extract<FormingOperation, { kind: "roll" }>): number {
  const arc = rollArcLengthMm(op);
  return arc > 0 ? Math.ceil(arc / STEP_BEND_PITCH_MM - EPS) : 0;
}

/** In-house feasibility of one operation against the park (see the header). */
export function formingFeasibility(op: FormingOperation, ctx: Pick<FormingContext, "thicknessMm" | "materialCode" | "machines" | "rates">): FormingFeasibility {
  if (op.kind === "roll") {
    const roll = machineOf(ctx.machines, "roll");
    if (!roll) return { feasible: false, reason: "no_machine", value: 0, limit: 0 };
    const { minRadiusMm, maxThicknessMm, maxWidthMm } = roll.limits;
    if (op.insideRadiusMm < minRadiusMm - EPS) return { feasible: false, reason: "min_radius", value: op.insideRadiusMm, limit: minRadiusMm };
    if (ctx.thicknessMm !== null && ctx.thicknessMm > maxThicknessMm + EPS) return { feasible: false, reason: "max_thickness", value: ctx.thicknessMm, limit: maxThicknessMm };
    if (op.widthMm > maxWidthMm + EPS) return { feasible: false, reason: "max_width", value: op.widthMm, limit: maxWidthMm };
    return { feasible: true };
  }
  const brake = machineOf(ctx.machines, "press_brake");
  if (!brake) return { feasible: false, reason: "no_machine", value: 0, limit: 0 };
  if (op.lengthMm > brake.limits.bendLengthMm + EPS) return { feasible: false, reason: "bend_length", value: op.lengthMm, limit: brake.limits.bendLengthMm };
  const material = ctx.rates ? findMaterial(ctx.rates, ctx.materialCode) : null;
  const t = ctx.thicknessMm;
  if (material && t !== null && t > 0 && brake.limits.dieFactor > 0 && op.lengthMm > 0) {
    const forceN = bendForceN(material.rmNmm2, t, op.lengthMm, defaultDieVMm(t, brake.limits.dieFactor));
    const limitN = brake.limits.forceKN * 1000;
    if (forceN > limitN + EPS) return { feasible: false, reason: "force", value: forceN / 1000, limit: brake.limits.forceKN };
  }
  return { feasible: true };
}

function flag(ctx: FormingContext, code: Flag["code"], severity: Flag["severity"], params: Record<string, number | string>): Flag {
  return { code, severity, partId: ctx.partId, itemId: ctx.itemId, params, overridable: severity === "amber" };
}

function describe(op: FormingOperation): Record<string, number | string> {
  // opId lets the UI match a flag to its operation by id instead of by geometry.
  return op.kind === "roll"
    ? { opId: op.id, operation: "roll", kind: "roll", radiusMm: op.insideRadiusMm, angleDeg: op.angleDeg, widthMm: op.widthMm }
    : { opId: op.id, operation: "bend", kind: "bend", bends: op.bends, angleDeg: op.angleDeg, lengthMm: op.lengthMm };
}

/** Feasibility, resolution and cost drivers of an item's forming operations (see the header). */
export function assessForming(ops: readonly FormingOperation[] | null | undefined, ctx: FormingContext): FormingAssessment {
  const out: FormingAssessment = { flags: [], unresolved: false, labourMin: 0, subcontractCostEur: 0, extraLeadDays: 0, usesPressBrake: false, usesRoll: false, charges: [] };
  const rates = ctx.jobRates ?? null;
  for (const op of ops ?? []) {
    const resolution: FormingResolution | null = op.resolution;
    if (resolution?.kind === "none_needed") continue;
    const feasibility = formingFeasibility(op, ctx);
    const base = { ...describe(op), materialCode: ctx.materialCode ?? "", thicknessMm: ctx.thicknessMm ?? 0 };

    if (resolution?.kind === "step_bend") {
      const hits = Number.isFinite(resolution.hits) ? Math.floor(resolution.hits) : 0;
      if (hits <= 0) {
        out.unresolved = true;
        out.flags.push(flag(ctx, "forming.not_feasible", "red", { ...base, reason: "step_bend_hits", value: hits, limit: 1 }));
        continue;
      }
      const minutes = rates ? (hits * rates.assembly.stepBendSecondsPerHit) / 60 : 0;
      out.labourMin += minutes;
      out.usesPressBrake = true;
      out.charges.push({ kind: "step_bend", opId: op.id, hits, minutes, radiusMm: op.kind === "roll" ? op.insideRadiusMm : 0, angleDeg: op.angleDeg });
      out.flags.push(flag(ctx, "forming.step_bend", "amber", { ...base, radiusMm: op.kind === "roll" ? op.insideRadiusMm : 0, hits, minutes }));
      continue;
    }

    if (resolution?.kind === "subcontract") {
      const marginPct = rates?.subcontractMarginPct ?? 0;
      const cost = Number.isFinite(resolution.costEur) && resolution.costEur > 0 ? resolution.costEur : 0;
      const priced = cost * (1 + marginPct / 100);
      out.subcontractCostEur += priced;
      out.extraLeadDays = Math.max(out.extraLeadDays, Number.isFinite(resolution.extraLeadDays) ? resolution.extraLeadDays : 0);
      out.charges.push({ kind: "subcontract", opId: op.id, operation: op.kind, supplier: resolution.supplier, costEur: cost, marginPct, pricedEur: priced, extraLeadDays: resolution.extraLeadDays });
      out.flags.push(flag(ctx, "forming.subcontract", "amber", { ...base, supplier: resolution.supplier, costEur: cost, marginPct, extraLeadDays: resolution.extraLeadDays }));
      continue;
    }

    // null or in_house
    if (!feasibility.feasible) {
      out.unresolved = true;
      out.flags.push(flag(ctx, "forming.not_feasible", "red", { ...base, reason: feasibility.reason, value: feasibility.value, limit: feasibility.limit }));
      continue;
    }
    if (op.kind === "roll") {
      const metres = op.widthMm / 1000;
      const minutes = rates ? rates.assembly.rollMinPerM * metres : 0;
      out.labourMin += minutes;
      out.usesRoll = true;
      out.charges.push({ kind: "roll", opId: op.id, widthMm: op.widthMm, metres, minutes });
    } else {
      out.usesPressBrake = true;
      out.charges.push({ kind: "bend", opId: op.id, bends: op.bends, lengthMm: op.lengthMm });
    }
  }
  return out;
}

/* ─── Suspected forming ───────────────────────────────────── */

export type FormingHint = "roll_annotation" | "forming_rolled" | "layer_roll" | "forming_bent" | "layer_bend";

const ROLL_LAYER = /roll|walc/i;
const BEND_LAYER = /bend|gi[eę]c|fold/i;

/** Whether the part's own bend model already prices its bends (recognised, non-candidate bend lines or bend annotations). */
function hasPricedBends(part: PricingPart): boolean {
  return part.annotations.bends.length > 0 || part.geometry.measures.bendLines.some((b) => b.source !== "candidate");
}

/**
 * Layers that carry geometry in this part: the entities kept plus lines
 * dropped only because their layer is ignored. The header's layer TABLE is
 * deliberately not used — a CAD template lists ROLL / BEND on every export,
 * including flat parts, and would flag a whole quote red (SM-2026-0022).
 */
function layersWithGeometry(geometry: PricingPart["geometry"]): string[] {
  const layers = new Set<string>();
  for (const e of geometry.entities) layers.add(e.layer);
  for (const d of geometry.dropped ?? []) if (d.reason === "ignored_layer") layers.add(d.layer);
  return [...layers];
}

/** The strongest forming hint of a part that no line model prices (see the header), or null. */
export function formingHint(part: PricingPart): FormingHint | null {
  const { annotations, geometry } = part;
  if (annotations.roll) return "roll_annotation";
  if (annotations.forming === "rolled") return "forming_rolled";
  const layers = layersWithGeometry(geometry);
  if (layers.some((l) => ROLL_LAYER.test(l))) return "layer_roll";
  if (hasPricedBends(part)) return null;
  if (annotations.forming === "bent") return "forming_bent";
  if (layers.some((l) => BEND_LAYER.test(l))) return "layer_bend";
  return null;
}

/** True when the drawing / annotations hint at forming while the item carries no forming operation and no none_needed confirmation. */
export function formingSuspected(part: PricingPart, forming: readonly FormingOperation[] | null | undefined = null): boolean {
  const ops = forming ?? [];
  if (ops.length > 0) return false;
  return formingHint(part) !== null;
}
