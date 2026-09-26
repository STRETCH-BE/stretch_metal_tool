/**
 * Pricing engine — the welding-only block (seams listed by hand or marked
 * on a drawing), shared by the cost-mode pricer (price-quote.ts) and the
 * market-mode pricer (market.ts).
 * File path: /lib/pricing/welding-block.ts
 *
 * Each seam = effective length × qty × €/mm, one setup per process used,
 * handling = weldHandlingPerPart × partsCount, then the largest minOrder
 * among the processes used — a shortfall becomes a "weld_min_order" line
 * and a green weld.min_order_applied flag. The block has no per-part
 * quantity, so its lines are lot lines (unitCost = line total). MinOrder
 * is compared with COST (weld rate rows are cost tables in every version;
 * margin is applied afterwards by the caller's marginPct).
 */

import type { WeldProcess } from "../geometry/types";
import { setupShare as spreadSetup, weldCost, weldEffectiveLengthMm } from "./formulas";
import { OPERATION_LABELS } from "./labels";
import { findWeldRate } from "./lookup";
import { weldRateRef } from "./operations";
import { priceFromCost, type Flag, type OperationLine, type OperationType, type PricedQuote, type QuoteInput, type RateSnapshot, type WeldRate } from "./types";
import { validateWeldingOnly } from "./validate";

export type WeldingBlock = NonNullable<PricedQuote["welding"]> & { flags: Flag[] };

export function lotLine(
  id: string,
  type: OperationType,
  label: string,
  driverQty: number,
  driverUnit: OperationLine["driverUnit"],
  rateRef: OperationLine["rateRef"],
  unitCost: number,
  setupShare: number,
  details: OperationLine["details"]
): OperationLine {
  return { id, type, label, driverQty, driverUnit, rateRef, unitCost, setupShare, auto: true, notes: null, details };
}

export function priceWeldingOnly(
  block: NonNullable<QuoteInput["weldingOnly"]>,
  rates: RateSnapshot,
  marginPct: number
): WeldingBlock {
  validateWeldingOnly(block);
  const general = rates.general;
  const operations: OperationLine[] = [];
  const flags: Flag[] = [];
  const processRows = new Map<WeldProcess, WeldRate>();

  for (const seam of block.seams) {
    const row = findWeldRate(rates, seam.process, seam.beadMm);
    if (!row) {
      flags.push({
        code: "weld.no_rate_row",
        severity: "red",
        partId: null,
        itemId: null,
        params: { seamId: seam.id, process: seam.process, beadMm: seam.beadMm },
        overridable: false,
      });
      continue;
    }
    const stitch = seam.pattern === "stitch" ? (seam.stitch ?? general.defaultStitch) : null;
    const perSeam = weldEffectiveLengthMm(seam.lengthMm, seam.pattern, stitch, seam.sides);
    const effective = perSeam * seam.qty;
    if (!processRows.has(seam.process)) processRows.set(seam.process, row);
    operations.push(
      lotLine(
        `welding:${seam.id}`,
        "weld",
        seam.label || OPERATION_LABELS.weld,
        effective,
        "mm",
        weldRateRef(row),
        weldCost(effective, row.pricePerMm),
        0,
        {
          seamId: seam.id,
          process: seam.process,
          beadMm: seam.beadMm,
          pattern: seam.pattern,
          beadLengthMm: stitch?.beadLengthMm ?? null,
          pitchMm: stitch?.pitchMm ?? null,
          sides: seam.sides,
          lengthMm: seam.lengthMm,
          qty: seam.qty,
          effectivePerSeamMm: perSeam,
          effectiveLengthMm: effective,
        }
      )
    );
  }

  for (const [process, row] of processRows) {
    operations.push(
      lotLine(
        `welding-setup:${process}`,
        "setup",
        OPERATION_LABELS.weldSetup,
        1,
        "lot",
        weldRateRef(row),
        spreadSetup(row.setup, 1),
        row.setup,
        { process, setup: row.setup }
      )
    );
  }

  if (block.partsCount > 0 && operations.length > 0) {
    operations.push(
      lotLine(
        "welding-handling",
        "handling",
        OPERATION_LABELS.weldHandling,
        block.partsCount,
        "part",
        {
          table: "rate_general",
          key: "weld_handling_per_part",
          values: { weldHandlingPerPart: general.weldHandlingPerPart, placeholder: general.placeholder },
        },
        general.weldHandlingPerPart * block.partsCount,
        0,
        { partsCount: block.partsCount, perPart: general.weldHandlingPerPart }
      )
    );
  }

  let cost = operations.reduce((sum, op) => sum + op.unitCost, 0);
  let minOrderApplied = false;
  if (processRows.size > 0) {
    let minOrder = 0;
    let minRow: WeldRate | null = null;
    for (const row of processRows.values()) {
      if (row.minOrder > minOrder) {
        minOrder = row.minOrder;
        minRow = row;
      }
    }
    if (minRow && cost < minOrder) {
      const shortfall = minOrder - cost;
      operations.push(
        lotLine(
          "welding-min-order",
          "weld",
          OPERATION_LABELS.weldMinOrder,
          1,
          "lot",
          {
            table: "rate_weld",
            key: `${minRow.process}/${minRow.beadMm}/min_order`,
            values: { process: minRow.process, beadMm: minRow.beadMm, minOrder, placeholder: minRow.placeholder },
          },
          shortfall,
          0,
          { minOrder, totalBefore: cost, shortfall }
        )
      );
      cost = minOrder;
      minOrderApplied = true;
    }
  }

  return { operations, cost, price: priceFromCost(cost, marginPct), minOrderApplied, flags };
}
