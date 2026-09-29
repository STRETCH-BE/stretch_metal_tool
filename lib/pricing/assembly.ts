/**
 * Pricing engine — welded assemblies priced as ONE line each (assembly
 * mode, docs/assembly-mode-design.md §3 "Welded assembly"). Pure: rates
 * only from the snapshots, the machine park and the JobRates passed in.
 * File path: /lib/pricing/assembly.ts
 *
 * Members (items with assemblyId) are never priced as loose lines. Per
 * assembly piece (assembly.qty pieces):
 *  1. Parts at cost — for every member the COST version's lines from
 *     buildContextOperations (material, cutting, per-bend prices, threads,
 *     extras, engraving) WITHOUT set-ups: "setup" lines are dropped and the
 *     set-up folded into a line (roll, tube) is subtracted (setupShare → 0).
 *     Weld lines are dropped too (seams live at assembly level) and roll
 *     lines as well (rolling is a forming operation here). × qtyPerAssembly.
 *     costRates null → the quote's own snapshot prices the parts (cost mode:
 *     the tables ARE costs; market mode without a cost version: the market
 *     prices stand in for cost — market.no_cost_version already warns).
 *  2. Labour (assembly_rates): fit-up = fitup_min_per_part × parts per
 *     assembly (Σ qtyPerAssembly); tacks = tack_seconds × Σ tack_count;
 *     welding = Σ over COUNTED seams (pairedSeamId null) of effective length
 *     ÷ weldSpeedFor(process, t) with effective = length × (bead ÷ pitch for
 *     stitch, capped at 1) × sides, t = seam.thicknessMm ?? assembly
 *     thickness ?? the marked member's thickness ?? the thickest member (a
 *     seam without any thickness takes the slowest speed of its process);
 *     deburr = deburr_min_per_part × parts; handling once; forming from
 *     assessForming (step-bend hits, rolling minutes). (fit-up + tacks +
 *     welding) × distortion_factor + deburr + handling + forming = totalMin
 *     → × labour_rate_eur_h; arc minutes (welding + tacks, undistorted) ×
 *     gas_wire_eur_h on top.
 *  3. Job set-ups (job_setup_rates), once per JOB and spread over the
 *     assembly qty: laser_nest per distinct (material, thickness) nest of
 *     the members — a nest already charged by a loose part
 *     (ctx.chargedNests, the loose lines' laser_setup keys) or by an earlier
 *     assembly is not charged again; press_brake once per job when any
 *     member has bend lines or a bend / step-bend operation; roll once per
 *     job when any member is rolled in house; weld_fitup once per assembly.
 *  4. Subcontracted forming: costEur × (1 + subcontract_margin_pct/100) per
 *     part piece × qtyPerAssembly.
 *  5. unitPrice = unitCost ÷ (1 − max(quote margin, assembly_margin_pct)/100);
 *     null (unpriceable) when a forming operation is unresolved, a member
 *     is refused (a red part flag on the cost snapshot: no material, no
 *     thickness, no laser row, no price band …) or a seam's process has no
 *     weld speed.
 * Material consistency: a member whose material differs from the
 * assembly's without materialOverride → one amber assembly.mixed_materials
 * per assembly ({ materials }); DC01 where the assembly says S235 → amber
 * material.substituted on the member ({ materialCode, requested, note })
 * instead. A member with NO material / thickness inherits the assembly's
 * (the engine never overrides a material the part carries). No counted
 * seam and no tack → amber assembly.no_seams. Members' PricedItem rows
 * carry operations [], unitCost = their parts-at-cost per piece (the
 * assembly line already contains it — the quote subtotal must not add
 * them again), unitPrice null, qty = assembly.qty × qtyPerAssembly, and the
 * part / forming / material flags.
 * Line ids are `${assemblyId}:<kind>` (":parts:<itemId>", ":fitup",
 * ":tack", ":weld", ":gas-wire", ":deburr", ":handling",
 * ":step-bend:<itemId>:<opId>", ":roll-forming:<itemId>:<opId>",
 * ":subcontract:<itemId>:<opId>", ":setup-laser-nest:<key>",
 * ":setup-press-brake", ":setup-roll", ":setup-weld-fitup"). Rate
 * references use table "manual" with the settings table and key in `key`
 * (RateRef.table is a closed union) and JobRates.placeholder as the
 * placeholder marker.
 */

import { buildPartContext } from "./context";
import { PricingError } from "./errors";
import { assessForming, formingHint, formingSuspected, type FormingAssessment, type FormingCharge } from "./forming";
import { weldEffectiveLengthMm } from "./formulas";
import { weldSpeedFor } from "./job-rates";
import { OPERATION_LABELS } from "./labels";
import { findMaterial } from "./lookup";
import { buildContextOperations } from "./operations";
import {
  priceFromCost,
  type AssemblyLabour,
  type AssemblySeam,
  type Flag,
  type JobRates,
  type MachinePark,
  type OperationLine,
  type OperationType,
  type PricedAssembly,
  type PricedItem,
  type PricingAssembly,
  type PricingItem,
  type PricingPart,
  type QuoteInput,
  type RateRef,
  type RateSnapshot,
} from "./types";

export type AssemblyPricingContext = {
  /** The version the quote is priced with (material codes for the nest keys). */
  rates: RateSnapshot;
  /** Cost version for the parts at cost; null → `rates`. */
  costRates: RateSnapshot | null;
  machines: MachinePark;
  jobRates: JobRates;
  /** Nest keys ("<material>/<t>") whose laser_nest set-up is already charged by loose lines. */
  chargedNests?: ReadonlySet<string>;
};

export type AssemblyPricingResult = {
  assemblies: PricedAssembly[];
  /** PricedItem rows of the members (operations [], unitPrice null), in input order. */
  items: PricedItem[];
  /** Every flag: the members' (also on items[].flags) and the assemblies' (also on assemblies[].flags). */
  flags: Flag[];
  /** Nest keys of every member (charged here or elsewhere). */
  nests: Set<string>;
  usesPressBrake: boolean;
  usesRoll: boolean;
};

/** Cost lines a member does NOT contribute to the parts-at-cost figure (set-ups spread elsewhere, seams and forming priced at assembly level). */
export const PARTS_AT_COST_EXCLUDED_TYPES: ReadonlySet<OperationType> = new Set<OperationType>(["setup", "weld", "roll"]);

/** Substitute grades: quoting `member` where the assembly asks for `requested` is a substitution, not a mix. */
const SUBSTITUTES: ReadonlyArray<readonly [member: string, requested: string]> = [["DC01", "S235"]];

const EPS = 1e-9;

/* ─── Partitioning ────────────────────────────────────────── */

export type ItemPartition = {
  loose: PricingItem[];
  members: PricingItem[];
  assemblies: PricingAssembly[];
  membersByAssembly: Map<string, PricingItem[]>;
};

/** Loose items vs members, by assembly (position order); a member of an unknown assembly is invalid input. */
export function partitionItems(input: Pick<QuoteInput, "items" | "assemblies">): ItemPartition {
  const assemblies = [...(input.assemblies ?? [])].sort((a, b) => a.position - b.position);
  const byId = new Map(assemblies.map((a) => [a.id, a] as const));
  const membersByAssembly = new Map<string, PricingItem[]>(assemblies.map((a) => [a.id, []]));
  const loose: PricingItem[] = [];
  const members: PricingItem[] = [];
  for (const item of input.items) {
    const assemblyId = item.assemblyId ?? null;
    if (assemblyId === null) {
      loose.push(item);
      continue;
    }
    if (!byId.has(assemblyId)) {
      throw new PricingError("invalid_input", `item ${item.id} refers to unknown assembly ${assemblyId}`, { itemId: item.id, field: "assemblyId", value: assemblyId });
    }
    members.push(item);
    membersByAssembly.get(assemblyId)?.push(item);
  }
  return { loose, members, assemblies, membersByAssembly };
}

/** Order quantity of a member: assembly.qty × qtyPerAssembly (the server keeps item.qty equal to it; the engine recomputes). */
export function memberQty(assembly: Pick<PricingAssembly, "qty">, item: Pick<PricingItem, "qtyPerAssembly">): number {
  return assembly.qty * (item.qtyPerAssembly ?? 1);
}

/** Laser-nest key of a material / thickness — the same shape as the loose lines' laser_setup rateRef.key (market.ts laserSetupGroupKey). */
export function nestKey(materialCode: string, thicknessMm: number): string {
  return `${materialCode}/${thicknessMm}`;
}

function upper(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase() ?? "";
  return c === "" ? null : c;
}

/** A member with no material / thickness of its own inherits the assembly's (materialOverride keeps a null material null). */
export function effectiveMemberPart(part: PricingPart, item: PricingItem, assembly: PricingAssembly): PricingPart {
  const materialCode = part.materialCode ?? (item.materialOverride ? null : assembly.materialCode);
  const ownThickness = part.thicknessMm ?? part.geometry.material.thicknessMm;
  const thicknessMm = ownThickness ?? assembly.thicknessMm;
  if (materialCode === part.materialCode && thicknessMm === part.thicknessMm) return part;
  return { ...part, materialCode, thicknessMm };
}

/* ─── Line helpers ────────────────────────────────────────── */

type LineSpec = {
  id: string;
  type: OperationType;
  label: string;
  driverQty: number;
  driverUnit: OperationLine["driverUnit"];
  rateRef: RateRef;
  unitCost: number;
  setupShare?: number;
  details: OperationLine["details"];
};

function line(spec: LineSpec): OperationLine {
  return {
    id: spec.id,
    type: spec.type,
    label: spec.label,
    driverQty: spec.driverQty,
    driverUnit: spec.driverUnit,
    rateRef: spec.rateRef,
    unitCost: spec.unitCost,
    setupShare: spec.setupShare ?? 0,
    auto: true,
    notes: null,
    details: spec.details,
  };
}

function labourRef(jobRates: JobRates, key: string, extra: RateRef["values"] = {}): RateRef {
  const a = jobRates.assembly;
  return {
    table: "manual",
    key: `assembly_rates/${key}`,
    values: { labourRateEurH: a.labourRateEurH, distortionFactor: a.distortionFactor, ...extra, placeholder: jobRates.placeholder },
  };
}

function setupRef(jobRates: JobRates, code: keyof JobRates["setups"], qty: number): RateRef {
  return { table: "manual", key: `job_setup_rates/${code}`, values: { code, costEur: jobRates.setups[code], qty, placeholder: jobRates.placeholder } };
}

function assemblyFlag(assemblyId: string, code: Flag["code"], severity: Flag["severity"], params: Record<string, number | string>): Flag {
  return { code, severity, partId: null, itemId: null, params: { assemblyId, ...params }, overridable: severity === "amber" };
}

function memberFlag(part: PricingPart, item: PricingItem, code: Flag["code"], severity: Flag["severity"], params: Record<string, number | string>): Flag {
  return { code, severity, partId: part.id, itemId: item.id, params, overridable: severity === "amber" };
}

/* ─── Members ─────────────────────────────────────────────── */

type MemberCost = {
  item: PricingItem;
  part: PricingPart;
  qtyPerAssembly: number;
  qty: number;
  /** Parts-at-cost lines per member piece (set-ups stripped). */
  lines: OperationLine[];
  perPieceCost: number;
  materialCode: string | null;
  thicknessMm: number | null;
  nestKey: string | null;
  hasBends: boolean;
  refused: boolean;
  forming: FormingAssessment;
  flags: Flag[];
  placeholder: boolean;
};

function stripSetups(lines: readonly OperationLine[]): OperationLine[] {
  const out: OperationLine[] = [];
  for (const l of lines) {
    if (PARTS_AT_COST_EXCLUDED_TYPES.has(l.type)) continue;
    out.push(l.setupShare !== 0 ? { ...l, unitCost: l.unitCost - l.setupShare, setupShare: 0 } : l);
  }
  return out;
}

/** Flags of the cost snapshot that do not apply to a member (its seams and rolling are priced at assembly level). */
function memberContextFlag(f: Flag): boolean {
  return !f.code.startsWith("weld.") && !f.code.startsWith("roll.");
}

function priceMember(part: PricingPart, item: PricingItem, assembly: PricingAssembly, ctx: AssemblyPricingContext): MemberCost {
  const costSnap = ctx.costRates ?? ctx.rates;
  const qtyPerAssembly = item.qtyPerAssembly ?? 1;
  if (!Number.isFinite(qtyPerAssembly) || qtyPerAssembly <= 0) {
    throw new PricingError("invalid_qty", `item ${item.id}: qtyPerAssembly must be > 0, got ${String(qtyPerAssembly)}`, { itemId: item.id, qty: String(qtyPerAssembly) });
  }
  const qty = memberQty(assembly, item);
  const effective = effectiveMemberPart(part, item, assembly);
  const member: PricingItem = { ...item, qty };
  const partCtx = buildPartContext(effective, member, costSnap, ctx.machines);
  const built = buildContextOperations(partCtx);
  const lines = stripSetups(built.operations);
  const perPieceCost = lines.reduce((sum, l) => sum + l.unitCost, 0);
  const contextFlags = built.flags.filter(memberContextFlag);
  const refused = contextFlags.some((f) => f.severity === "red");

  const forming = assessForming(item.forming ?? [], {
    thicknessMm: partCtx.thicknessMm,
    materialCode: partCtx.material?.code ?? effective.materialCode,
    machines: ctx.machines,
    partId: part.id,
    itemId: item.id,
    rates: costSnap,
    jobRates: ctx.jobRates,
  });
  const flags: Flag[] = [...contextFlags, ...forming.flags];
  if (formingSuspected(effective, item.forming)) {
    flags.push(memberFlag(part, item, "forming.suspected", "red", { hint: formingHint(effective) ?? "" }));
  }

  // Material consistency against the assembly.
  const materialCode = partCtx.material?.code ?? upper(effective.materialCode);
  const requested = upper(assembly.materialCode);
  if (materialCode && requested && upper(materialCode) !== requested) {
    const substitute = SUBSTITUTES.some(([m, r]) => m === upper(materialCode) && r === requested);
    if (substitute) {
      flags.push(memberFlag(part, item, "material.substituted", "amber", { materialCode, requested, note: item.materialNote ?? "" }));
    }
  }

  // Nest key from the QUOTE version's material row (the same code the loose lines' laser_setup key uses).
  const quoteMaterial = findMaterial(ctx.rates, effective.materialCode)?.code ?? materialCode;
  const nest = quoteMaterial && partCtx.thicknessMm !== null ? nestKey(quoteMaterial, partCtx.thicknessMm) : null;

  return {
    item,
    part,
    qtyPerAssembly,
    qty,
    lines,
    perPieceCost,
    materialCode,
    thicknessMm: partCtx.thicknessMm,
    nestKey: nest,
    hasBends: partCtx.bends.some((b) => b.lengthMm > 0),
    refused,
    forming,
    flags,
    placeholder: lines.some((l) => l.rateRef.values.placeholder === true),
  };
}

/* ─── Seams ───────────────────────────────────────────────── */

type SeamCharge = {
  seam: AssemblySeam;
  thicknessMm: number | null;
  speedMmMin: number | null;
  effectiveLengthMm: number;
  minutes: number;
  tacks: number;
};

function seamThickness(seam: AssemblySeam, assembly: PricingAssembly, members: readonly MemberCost[]): number | null {
  if (seam.thicknessMm !== null && seam.thicknessMm > 0) return seam.thicknessMm;
  if (assembly.thicknessMm !== null && assembly.thicknessMm > 0) return assembly.thicknessMm;
  const marked = seam.partId ? members.find((m) => m.part.id === seam.partId) : undefined;
  if (marked?.thicknessMm) return marked.thicknessMm;
  const thicknesses = members.map((m) => m.thicknessMm).filter((t): t is number => t !== null && t > 0);
  return thicknesses.length > 0 ? Math.max(...thicknesses) : null;
}

function chargeSeam(seam: AssemblySeam, assembly: PricingAssembly, members: readonly MemberCost[], ctx: AssemblyPricingContext): SeamCharge {
  const thicknessMm = seamThickness(seam, assembly, members);
  const speed = weldSpeedFor(ctx.jobRates, seam.process, thicknessMm ?? Number.POSITIVE_INFINITY);
  if (seam.type === "tack") {
    return { seam, thicknessMm, speedMmMin: speed, effectiveLengthMm: 0, minutes: 0, tacks: Math.max(0, seam.tackCount ?? 0) };
  }
  const stitch = seam.type === "stitch" ? (seam.stitch ?? ctx.rates.general.defaultStitch) : null;
  const effective = weldEffectiveLengthMm(seam.lengthMm, seam.type === "stitch" ? "stitch" : "full", stitch, seam.sides);
  const minutes = speed !== null && speed > 0 ? effective / speed : 0;
  return { seam, thicknessMm, speedMmMin: speed, effectiveLengthMm: effective, minutes, tacks: 0 };
}

/* ─── One assembly ────────────────────────────────────────── */

type JobState = { chargedNests: Set<string>; pressBrakeCharged: boolean; rollCharged: boolean };

function priceAssembly(
  assembly: PricingAssembly,
  memberItems: readonly PricingItem[],
  partsById: ReadonlyMap<string, PricingPart>,
  input: QuoteInput,
  ctx: AssemblyPricingContext,
  job: JobState
): { priced: PricedAssembly; items: PricedItem[]; nests: Set<string>; usesPressBrake: boolean; usesRoll: boolean } {
  if (!Number.isFinite(assembly.qty) || assembly.qty <= 0) {
    throw new PricingError("invalid_qty", `assembly ${assembly.id}: qty must be > 0, got ${String(assembly.qty)}`, { assemblyId: assembly.id, qty: String(assembly.qty) });
  }
  const jobRates = ctx.jobRates;
  const a = jobRates.assembly;
  const qty = assembly.qty;

  const members: MemberCost[] = memberItems.map((item) => {
    const part = partsById.get(item.partId);
    if (!part) {
      throw new PricingError("missing_part", `item ${item.id} refers to unknown part ${item.partId}`, { itemId: item.id, partId: item.partId });
    }
    return priceMember(part, item, assembly, ctx);
  });

  const assemblyFlags: Flag[] = [];
  const operations: OperationLine[] = [];

  // 1. Parts at cost.
  for (const m of members) {
    const material = m.lines.filter((l) => l.type === "material").reduce((s, l) => s + l.unitCost, 0);
    const cutting = m.lines.filter((l) => l.type === "laser_cut" || l.type === "subcontract_cutting").reduce((s, l) => s + l.unitCost, 0);
    operations.push(
      line({
        id: `${assembly.id}:parts:${m.item.id}`,
        type: "material",
        label: OPERATION_LABELS.assemblyParts,
        driverQty: m.qtyPerAssembly,
        driverUnit: "part",
        rateRef: {
          table: "manual",
          key: `parts_at_cost/${(ctx.costRates ?? ctx.rates).versionId}`,
          values: { costRateVersionId: (ctx.costRates ?? ctx.rates).versionId, perPieceCost: m.perPieceCost, lines: m.lines.length, placeholder: m.placeholder },
        },
        unitCost: m.perPieceCost * m.qtyPerAssembly,
        details: {
          itemId: m.item.id,
          partId: m.part.id,
          partName: m.part.name,
          qtyPerAssembly: m.qtyPerAssembly,
          perPieceCost: m.perPieceCost,
          materialEur: material,
          cuttingEur: cutting,
          otherEur: m.perPieceCost - material - cutting,
          materialCode: m.materialCode,
          thicknessMm: m.thicknessMm,
          nestKey: m.nestKey,
          lineIds: m.lines.map((l) => l.id).join(","),
        },
      })
    );
  }

  // Material consistency (assembly level).
  const requested = upper(assembly.materialCode);
  const mixed = new Set<string>();
  for (const m of members) {
    const code = upper(m.materialCode);
    if (!code || !requested || code === requested || m.item.materialOverride) continue;
    if (SUBSTITUTES.some(([mm, r]) => mm === code && r === requested)) continue;
    mixed.add(code);
  }
  if (mixed.size > 0) {
    assemblyFlags.push(assemblyFlag(assembly.id, "assembly.mixed_materials", "amber", { materials: [requested, ...mixed].filter(Boolean).join(", ") }));
  }

  // 2. Labour.
  const partsPerAssembly = members.reduce((s, m) => s + m.qtyPerAssembly, 0);
  const counted = assembly.seams.filter((s) => s.pairedSeamId === null);
  const seamCharges = counted.map((s) => chargeSeam(s, assembly, members, ctx));
  const weldSeams = seamCharges.filter((c) => c.seam.type !== "tack");
  const noSpeed = weldSeams.filter((c) => c.speedMmMin === null || c.speedMmMin <= 0);
  for (const c of noSpeed) {
    assemblyFlags.push(assemblyFlag(assembly.id, "weld.no_rate_row", "red", { seamId: c.seam.id, process: c.seam.process, thicknessMm: c.thicknessMm ?? 0, beadMm: 0 }));
  }
  const seamLengthMm = weldSeams.reduce((s, c) => s + c.seam.lengthMm, 0);
  const effectiveLengthMm = weldSeams.reduce((s, c) => s + c.effectiveLengthMm, 0);
  const tacks = seamCharges.reduce((s, c) => s + c.tacks, 0);
  if (weldSeams.length === 0 && tacks === 0) assemblyFlags.push(assemblyFlag(assembly.id, "assembly.no_seams", "amber", {}));

  const fitupMin = a.fitupMinPerPart * partsPerAssembly;
  const tackMin = (a.tackSeconds * tacks) / 60;
  const weldMin = weldSeams.reduce((s, c) => s + c.minutes, 0);
  const deburrMin = a.deburrMinPerPart * partsPerAssembly;
  const handlingMin = a.handlingMinPerAssembly;
  const formingMin = members.reduce((s, m) => s + m.forming.labourMin * m.qtyPerAssembly, 0);
  const distorted = (fitupMin + tackMin + weldMin) * a.distortionFactor;
  const totalMin = distorted + deburrMin + handlingMin + formingMin;
  const arcMin = weldMin + tackMin;
  const labour: AssemblyLabour = { fitupMin, tackMin, weldMin, deburrMin, handlingMin, formingMin, totalMin, arcMin };
  const perMin = a.labourRateEurH / 60;
  const f = a.distortionFactor;

  if (partsPerAssembly > 0) {
    operations.push(
      line({
        id: `${assembly.id}:fitup`,
        type: "weld",
        label: OPERATION_LABELS.assemblyFitup,
        driverQty: fitupMin * f,
        driverUnit: "min",
        rateRef: labourRef(jobRates, "fitup_min_per_part", { fitupMinPerPart: a.fitupMinPerPart }),
        unitCost: fitupMin * f * perMin,
        details: { parts: partsPerAssembly, minPerPart: a.fitupMinPerPart, baseMin: fitupMin, distortionFactor: f, minutes: fitupMin * f },
      })
    );
  }
  if (tacks > 0) {
    operations.push(
      line({
        id: `${assembly.id}:tack`,
        type: "weld",
        label: OPERATION_LABELS.assemblyTack,
        driverQty: tackMin * f,
        driverUnit: "min",
        rateRef: labourRef(jobRates, "tack_seconds", { tackSeconds: a.tackSeconds }),
        unitCost: tackMin * f * perMin,
        details: { tacks, tackSeconds: a.tackSeconds, baseMin: tackMin, distortionFactor: f, minutes: tackMin * f },
      })
    );
  }
  if (weldSeams.length > 0) {
    const processes = [...new Set(weldSeams.map((c) => c.seam.process))].join(",");
    const speeds = [...new Set(weldSeams.map((c) => `${c.seam.process}/${c.thicknessMm ?? "?"}:${c.speedMmMin ?? "-"}`))].join(",");
    operations.push(
      line({
        id: `${assembly.id}:weld`,
        type: "weld",
        label: OPERATION_LABELS.assemblyWeld,
        driverQty: weldMin * f,
        driverUnit: "min",
        rateRef: labourRef(jobRates, "weld", { weldSpeeds: speeds }),
        unitCost: weldMin * f * perMin,
        details: { seams: weldSeams.length, pairedSeamsSkipped: assembly.seams.length - counted.length, seamLengthMm, effectiveLengthMm, processes, speeds, baseMin: weldMin, distortionFactor: f, minutes: weldMin * f },
      })
    );
  }
  if (arcMin > 0) {
    operations.push(
      line({
        id: `${assembly.id}:gas-wire`,
        type: "weld",
        label: OPERATION_LABELS.assemblyGasWire,
        driverQty: arcMin,
        driverUnit: "min",
        rateRef: { table: "manual", key: "assembly_rates/gas_wire_eur_h", values: { gasWireEurH: a.gasWireEurH, placeholder: jobRates.placeholder } },
        unitCost: (arcMin / 60) * a.gasWireEurH,
        details: { arcMin, weldMin, tackMin, gasWireEurH: a.gasWireEurH, minutes: arcMin },
      })
    );
  }
  if (partsPerAssembly > 0) {
    operations.push(
      line({
        id: `${assembly.id}:deburr`,
        type: "finish_deburr",
        label: OPERATION_LABELS.assemblyDeburr,
        driverQty: deburrMin,
        driverUnit: "min",
        rateRef: labourRef(jobRates, "deburr_min_per_part", { deburrMinPerPart: a.deburrMinPerPart }),
        unitCost: deburrMin * perMin,
        details: { parts: partsPerAssembly, minPerPart: a.deburrMinPerPart, minutes: deburrMin },
      })
    );
  }
  operations.push(
    line({
      id: `${assembly.id}:handling`,
      type: "handling",
      label: OPERATION_LABELS.assemblyHandling,
      driverQty: handlingMin,
      driverUnit: "min",
      rateRef: labourRef(jobRates, "handling_min_per_assembly", { handlingMinPerAssembly: a.handlingMinPerAssembly }),
      unitCost: handlingMin * perMin,
      details: { minutes: handlingMin },
    })
  );

  // Forming charges (labour lines and subcontract lines) per member.
  let usesPressBrake = false;
  let usesRoll = false;
  let unresolved = false;
  for (const m of members) {
    if (m.forming.unresolved) unresolved = true;
    if (m.forming.usesPressBrake || m.hasBends) usesPressBrake = true;
    if (m.forming.usesRoll) usesRoll = true;
    for (const charge of m.forming.charges) operations.push(...formingLines(assembly, m, charge, jobRates));
  }

  // 3. Job set-ups, once per job, spread over the assembly quantity.
  const nests = new Set<string>();
  for (const m of members) if (m.nestKey) nests.add(m.nestKey);
  for (const key of [...nests].sort()) {
    if (job.chargedNests.has(key)) continue;
    job.chargedNests.add(key);
    const [materialCode, thicknessMm] = key.split("/");
    operations.push(setupLine(assembly, `setup-laser-nest:${key}`, OPERATION_LABELS.setupLaserNest, "laser_nest", jobRates, qty, { nestKey: key, materialCode, thicknessMm: Number(thicknessMm) }));
  }
  if (usesPressBrake && !job.pressBrakeCharged) {
    job.pressBrakeCharged = true;
    operations.push(setupLine(assembly, "setup-press-brake", OPERATION_LABELS.setupPressBrake, "press_brake", jobRates, qty, {}));
  }
  if (usesRoll && !job.rollCharged) {
    job.rollCharged = true;
    operations.push(setupLine(assembly, "setup-roll", OPERATION_LABELS.setupRoll, "roll", jobRates, qty, {}));
  }
  operations.push(setupLine(assembly, "setup-weld-fitup", OPERATION_LABELS.setupWeldFitup, "weld_fitup", jobRates, qty, { seams: counted.length }));

  // 5. Price.
  const marginPct = Math.max(input.marginPct, jobRates.assemblyMarginPct);
  if (!Number.isFinite(marginPct) || marginPct >= 100) {
    throw new PricingError("invalid_margin", `assembly ${assembly.id}: margin must be a finite percentage below 100, got ${String(marginPct)}`, { assemblyId: assembly.id, marginPct: String(marginPct) });
  }
  const unitCost = operations.reduce((s, l) => s + l.unitCost, 0);
  const refused = members.some((m) => m.refused);
  const priceable = !unresolved && !refused && noSpeed.length === 0;
  const unitPrice = priceable ? priceFromCost(unitCost, marginPct) : null;

  const items: PricedItem[] = members.map((m) => ({
    itemId: m.item.id,
    partId: m.part.id,
    qty: m.qty,
    operations: [],
    unitCost: m.perPieceCost,
    unitPrice: null,
    batchCost: m.perPieceCost * m.qty,
    batchPrice: null,
    flags: m.flags,
  }));

  const priced: PricedAssembly = {
    assemblyId: assembly.id,
    name: assembly.name,
    drawingRef: assembly.drawingRef,
    materialCode: assembly.materialCode,
    thicknessMm: assembly.thicknessMm,
    qty,
    memberItemIds: members.map((m) => m.item.id),
    operations,
    unitCost,
    unitPrice,
    batchCost: unitCost * qty,
    batchPrice: unitPrice === null ? null : unitPrice * qty,
    marginPct,
    labour,
    seamLengthMm,
    flags: assemblyFlags,
  };
  return { priced, items, nests, usesPressBrake, usesRoll };
}

function setupLine(assembly: PricingAssembly, suffix: string, label: string, code: keyof JobRates["setups"], jobRates: JobRates, qty: number, details: OperationLine["details"]): OperationLine {
  const share = jobRates.setups[code] / qty;
  return line({
    id: `${assembly.id}:${suffix}`,
    type: "setup",
    label,
    driverQty: 1,
    driverUnit: "lot",
    rateRef: setupRef(jobRates, code, qty),
    unitCost: share,
    setupShare: share,
    details: { code, setupEur: jobRates.setups[code], qty, ...details },
  });
}

function formingLines(assembly: PricingAssembly, m: MemberCost, charge: FormingCharge, jobRates: JobRates): OperationLine[] {
  const a = jobRates.assembly;
  const perMin = a.labourRateEurH / 60;
  const n = m.qtyPerAssembly;
  switch (charge.kind) {
    case "step_bend":
      return [
        line({
          id: `${assembly.id}:step-bend:${m.item.id}:${charge.opId}`,
          type: "bend",
          label: OPERATION_LABELS.stepBend,
          driverQty: charge.hits * n,
          driverUnit: "bend",
          rateRef: labourRef(jobRates, "step_bend_seconds_per_hit", { stepBendSecondsPerHit: a.stepBendSecondsPerHit }),
          unitCost: charge.minutes * n * perMin,
          details: { itemId: m.item.id, partId: m.part.id, opId: charge.opId, hits: charge.hits, hitsPerPart: charge.hits, qtyPerAssembly: n, radiusMm: charge.radiusMm, angleDeg: charge.angleDeg, secondsPerHit: a.stepBendSecondsPerHit, minutes: charge.minutes * n },
        }),
      ];
    case "roll":
      return [
        line({
          id: `${assembly.id}:roll-forming:${m.item.id}:${charge.opId}`,
          type: "roll",
          label: OPERATION_LABELS.rollForming,
          driverQty: charge.metres * n,
          driverUnit: "m",
          rateRef: labourRef(jobRates, "roll_min_per_m", { rollMinPerM: a.rollMinPerM }),
          unitCost: charge.minutes * n * perMin,
          details: { itemId: m.item.id, partId: m.part.id, opId: charge.opId, widthMm: charge.widthMm, qtyPerAssembly: n, rollMinPerM: a.rollMinPerM, minutes: charge.minutes * n },
        }),
      ];
    case "subcontract":
      return [
        line({
          id: `${assembly.id}:subcontract:${m.item.id}:${charge.opId}`,
          type: charge.operation === "roll" ? "roll" : "bend",
          label: OPERATION_LABELS.subcontractForming,
          driverQty: n,
          driverUnit: "part",
          rateRef: { table: "manual", key: "company_settings/subcontract_margin_pct", values: { supplier: charge.supplier, costEur: charge.costEur, marginPct: charge.marginPct, placeholder: false } },
          unitCost: charge.pricedEur * n,
          details: { itemId: m.item.id, partId: m.part.id, opId: charge.opId, operation: charge.operation, supplier: charge.supplier, costEur: charge.costEur, marginPct: charge.marginPct, pricedEur: charge.pricedEur, qtyPerAssembly: n, extraLeadDays: charge.extraLeadDays, subcontract: true },
        }),
      ];
    case "bend":
      // A feasible in-house bend operation: the member's bend lines already price it (parts at cost).
      return [];
  }
}

/* ─── Public API ──────────────────────────────────────────── */

/** Every welded assembly of the quote priced as one line (see the header). No assemblies → empty result. */
export function priceAssemblies(input: QuoteInput, ctx: AssemblyPricingContext): AssemblyPricingResult {
  const { assemblies, membersByAssembly } = partitionItems(input);
  const partsById = new Map(input.parts.map((p) => [p.id, p] as const));
  const job: JobState = { chargedNests: new Set(ctx.chargedNests ?? []), pressBrakeCharged: false, rollCharged: false };
  const out: AssemblyPricingResult = { assemblies: [], items: [], flags: [], nests: new Set(), usesPressBrake: false, usesRoll: false };
  const itemsById = new Map<string, PricedItem>();
  for (const assembly of assemblies) {
    const result = priceAssembly(assembly, membersByAssembly.get(assembly.id) ?? [], partsById, input, ctx, job);
    out.assemblies.push(result.priced);
    for (const item of result.items) itemsById.set(item.itemId, item);
    for (const key of result.nests) out.nests.add(key);
    out.usesPressBrake = out.usesPressBrake || result.usesPressBrake;
    out.usesRoll = out.usesRoll || result.usesRoll;
  }
  // Members in input order.
  for (const item of input.items) {
    const priced = itemsById.get(item.id);
    if (priced) out.items.push(priced);
  }
  out.flags = [...out.items.flatMap((i) => i.flags), ...out.assemblies.flatMap((a) => a.flags)];
  return out;
}

/** Sum over the assemblies' lines by operation type (cost side; set-up shares go to "setup"). */
export function accumulateAssemblyCosts(map: Partial<Record<OperationType, number>>, assembly: PricedAssembly): void {
  for (const op of assembly.operations) {
    const total = op.unitCost * assembly.qty;
    const setup = op.setupShare * assembly.qty;
    if (op.type === "setup") {
      map.setup = (map.setup ?? 0) + total;
      continue;
    }
    map[op.type] = (map[op.type] ?? 0) + total - setup;
    if (Math.abs(setup) > EPS) map.setup = (map.setup ?? 0) + setup;
  }
}
