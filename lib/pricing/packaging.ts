/**
 * Pricing engine — packaging from the admin table packaging_rates
 * (assembly mode, docs/assembly-mode-design.md §2 / §3 "Loose parts").
 * File path: /lib/pricing/packaging.ts
 *
 * Rule: the first row in `position` order whose limits hold (packed size
 * = the largest side of any part ≤ max_side_mm AND gross mass ≤
 * max_mass_kg), else the LAST row (the biggest packaging the table
 * knows — never "no packaging" for an over-size order). Gross mass = Σ net
 * mass of every priced part × its quantity × (1 + PACKAGING_ALLOWANCE_PCT)
 * (market-rules.ts, [CONFIRM] 5 %). No parts → no packaging line.
 *
 * The line is a quote-level lot line (id "quote:packaging", type
 * "packaging", label OPERATION_LABELS.packaging, cost = price — a
 * pass-through outside every margin). RateRef.table is the closed union of
 * rate tables, so the row is recorded as table "manual" with key
 * "packaging_rates/<code>" and the row's numbers in `values`; the
 * `placeholder` value is JobRates.placeholder (the settings tables are
 * confirmed as a whole). When priceQuote runs WITHOUT job rates the older
 * market-mode rule (rate_general box / pallet, market-rules.ts
 * decidePackaging) still applies unchanged.
 */

import { areaMassKg } from "./formulas";
import { OPERATION_LABELS } from "./labels";
import { findMaterial } from "./lookup";
import { PACKAGING_ALLOWANCE_PCT, grossMassKg } from "./market-rules";
import type { OperationLine, PackagingRate, PricingItem, PricingPart, RateSnapshot } from "./types";

/** What packaging needs to know about one priced part line. */
export type PackedPart = {
  /** Largest bbox side of the flat part (mm). */
  maxSideMm: number;
  /** Net mass of one piece (kg); null when thickness or density are unknown (counts as 0). */
  netMassKg: number | null;
  /** Pieces of this part in the order. */
  qty: number;
};

export type PackagingEnvelope = {
  largestSideMm: number;
  netKg: number;
  grossKg: number;
  parts: number;
};

/** Size and net mass of a part × item for the packaging rule (density from the snapshot's material row, else the geometry). */
export function packedPart(part: PricingPart, item: Pick<PricingItem, "qty">, rates: RateSnapshot): PackedPart {
  const { bbox, netAreaMm2 } = part.geometry.measures;
  const t = part.thicknessMm ?? part.geometry.material.thicknessMm;
  const density = findMaterial(rates, part.materialCode)?.densityKgM3 ?? part.geometry.material.densityKgM3;
  const netMassKg =
    t !== null && Number.isFinite(t) && t > 0 && density !== null && Number.isFinite(density) ? areaMassKg(netAreaMm2, t, density) : null;
  return { maxSideMm: Math.max(bbox.width, bbox.height, 0), netMassKg, qty: item.qty };
}

/** Largest side and net / gross mass over the parts of the order. */
export function packagingEnvelope(parts: readonly PackedPart[]): PackagingEnvelope {
  let largestSideMm = 0;
  let netKg = 0;
  for (const p of parts) {
    if (p.maxSideMm > largestSideMm) largestSideMm = p.maxSideMm;
    netKg += (p.netMassKg ?? 0) * p.qty;
  }
  return { largestSideMm, netKg, grossKg: grossMassKg(netKg), parts: parts.length };
}

/** The first row in position order whose limits hold, else the last row; null for an empty table. */
export function pickPackaging(rates: readonly PackagingRate[], largestSideMm: number, grossKg: number): PackagingRate | null {
  if (rates.length === 0) return null;
  const sorted = [...rates].sort((a, b) => a.position - b.position || a.maxMassKg - b.maxMassKg);
  return sorted.find((r) => largestSideMm <= r.maxSideMm + 1e-9 && grossKg <= r.maxMassKg + 1e-9) ?? sorted[sorted.length - 1];
}

/** The quote-level packaging line for a picked row; null when the row costs nothing. */
export function packagingLine(rate: PackagingRate, envelope: PackagingEnvelope, placeholder: boolean): OperationLine | null {
  if (rate.priceEur <= 0) return null;
  return {
    id: "quote:packaging",
    type: "packaging",
    label: OPERATION_LABELS.packaging,
    driverQty: 1,
    driverUnit: "lot",
    rateRef: {
      table: "manual",
      key: `packaging_rates/${rate.code}`,
      values: {
        code: rate.code,
        name: rate.name,
        maxSideMm: rate.maxSideMm,
        maxMassKg: rate.maxMassKg,
        priceEur: rate.priceEur,
        position: rate.position,
        placeholder,
      },
    },
    unitCost: rate.priceEur,
    setupShare: 0,
    auto: true,
    notes: null,
    details: {
      code: rate.code,
      name: rate.name,
      grossKg: envelope.grossKg,
      netKg: envelope.netKg,
      largestSideMm: envelope.largestSideMm,
      allowancePct: PACKAGING_ALLOWANCE_PCT,
      parts: envelope.parts,
    },
  };
}

/** Envelope → row → line in one step; null without parts, without rows or for a free row. */
export function packagingForParts(parts: readonly PackedPart[], rates: readonly PackagingRate[], placeholder: boolean): { line: OperationLine | null; envelope: PackagingEnvelope; rate: PackagingRate | null } {
  const envelope = packagingEnvelope(parts);
  if (parts.length === 0) return { line: null, envelope, rate: null };
  const rate = pickPackaging(rates, envelope.largestSideMm, envelope.grossKg);
  return { line: rate ? packagingLine(rate, envelope, placeholder) : null, envelope, rate };
}
