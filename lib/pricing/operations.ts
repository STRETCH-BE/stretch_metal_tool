/**
 * Pricing engine — turns one part × quote item into OperationLines (plus
 * the part's feasibility flags), build prompt Step 9 / spec §6.
 * File path: /lib/pricing/operations.ts
 *
 * Line order is deterministic: laser (or subcontract cutting), material,
 * one line per bend + one bend setup, roll, one line per weld seam + one
 * weld setup per process, confirmed threads (one line per size), the
 * item's extras in their own order, engraving. Ids are `${itemId}:<kind>`
 * so a re-price maps onto the stored `operations` rows.
 *
 * Money rules:
 * - `unitCost` is per part with setup already spread (setup / qty);
 *   `setupShare` records that spread so totalsByType can show setup in
 *   its own bucket. Bend and weld setups are their own "setup" lines;
 *   roll and tube setups are folded into the line (setupShare says how
 *   much).
 * - Every line's `rateRef` snapshots the row and numbers used (audit
 *   trail) and `details` carries what the UI shows (cut time, force …).
 * - A line whose rate row is missing is OMITTED — the matching `*.no_rate_row`
 *   flag from feasibility.ts says why. Every one of those flags is RED
 *   (bend and roll included): red blocks sending, so a quote can never go
 *   out with a silently free operation, not even through an override.
 * - Laser mode "per_m" (in-house per-metre rows and every supplier row)
 *   prices the PLAIN cut length; the slow-contour factor is applied in
 *   mode "time" only (Step 9). `details.slowFactorApplied` says which.
 * - Threads are priced only when confirmed (annotations.threads[loopId]
 *   = size); geometry suggestions alone are never priced.
 * - Tube parts (an item with a tube_cut extra) get no flat-laser / sheet
 *   material lines; their material is metres × pricePerMTube from the extra.
 * - Every user-typed number (qty, scrap, extras, weld/bend/roll
 *   annotations) is validated by lib/pricing/validate.ts inside
 *   buildPartContext before any line is built: NaN, Infinity or a negative
 *   value throws PricingError("invalid_input") instead of becoming a price.
 */

import type { WeldProcess } from "../geometry/types";
import { buildPartContext, type PartContext } from "./context";
import { evaluateContextFlags } from "./feasibility";
import { computeFinish } from "./finish";
import {
  adjustedCutLengthM,
  applyBatchMinimum,
  bendForceN,
  countCost,
  engraveCost,
  laserCutTimeMin,
  laserPerMCost,
  laserTimeCost,
  machiningCost,
  materialCost,
  mmToM,
  rollCost,
  setupShare,
  weldCost,
  weldEffectiveLengthMm,
} from "./formulas";
import { OPERATION_LABELS } from "./labels";
import {
  findBendRate,
  findFeatureRate,
  findFinishRate,
  findRollRate,
  findThreadRate,
  findTubeLaserRate,
  findWeldRate,
  normaliseThreadSize,
} from "./lookup";
import type {
  BendRate,
  DriverUnit,
  Flag,
  MachinePark,
  OperationLine,
  OperationType,
  PricingItem,
  PricingPart,
  RateRef,
  RateSnapshot,
  WeldRate,
} from "./types";

export type ItemOperations = { operations: OperationLine[]; flags: Flag[] };

type LineInput = {
  suffix: string;
  type: OperationType;
  label: string;
  driverQty: number;
  driverUnit: DriverUnit;
  rateRef: RateRef;
  unitCost: number;
  setupShare?: number;
  auto?: boolean;
  notes?: string | null;
  details?: OperationLine["details"];
};

function makeLine(ctx: PartContext, input: LineInput): OperationLine {
  return {
    id: `${ctx.item.id}:${input.suffix}`,
    type: input.type,
    label: input.label,
    driverQty: input.driverQty,
    driverUnit: input.driverUnit,
    rateRef: input.rateRef,
    unitCost: input.unitCost,
    setupShare: input.setupShare ?? 0,
    auto: input.auto ?? true,
    notes: input.notes ?? null,
    details: input.details ?? {},
  };
}

/* ─── Laser / subcontract cutting ─────────────────────────── */

function laserLine(ctx: PartContext): OperationLine | null {
  const { laser, thicknessMm, material, geometry, rates } = ctx;
  if (!laser?.row || thicknessMm === null || !material) return null;
  const m = geometry.measures;
  if (m.cutLengthMm <= 0) return null;
  const row = laser.row;
  const general = rates.general;
  const cutLengthM = mmToM(m.cutLengthMm);
  const slowLengthM = mmToM(ctx.slowLengthMm);
  const factor = general.slowContourFactor;
  const adjustedM = adjustedCutLengthM(cutLengthM, slowLengthM, factor);
  const pierces = m.pierces;

  let unitCost: number;
  let cutTimeMin: number | null = null;
  let driverQty: number;
  let driverUnit: DriverUnit;
  // Mode "time" is the only branch that uses the machine rate AND the
  // slow-contour factor (Step 9). Mode "per_m" prices the plain cut length.
  let usesMachineRate = false;
  if (row.mode === "time" && row.speedMMin !== null && row.speedMMin > 0 && row.pierceS !== null) {
    cutTimeMin = laserCutTimeMin(cutLengthM, row.speedMMin, pierces, row.pierceS, slowLengthM, factor);
    unitCost = laserTimeCost(cutTimeMin, general.machineRateEurH, pierces, row.pricePerPierce);
    driverQty = cutTimeMin;
    driverUnit = "min";
    usesMachineRate = true;
  } else if (row.pricePerM !== null) {
    unitCost = laserPerMCost(cutLengthM, row.pricePerM, pierces, row.pricePerPierce);
    driverQty = cutLengthM;
    driverUnit = "m";
  } else {
    return null;
  }
  const slowFactorApplied = usesMachineRate;

  const subcontract = laser.subcontract;
  return makeLine(ctx, {
    suffix: subcontract ? "subcontract" : "laser",
    type: subcontract ? "subcontract_cutting" : "laser_cut",
    label: subcontract ? OPERATION_LABELS.subcontractCutting : OPERATION_LABELS.laserCut,
    driverQty,
    driverUnit,
    unitCost,
    rateRef: {
      table: "rate_laser",
      key: `${row.materialCode}/${row.thicknessMm}${row.inHouse ? "" : "/supplier"}`,
      values: {
        materialCode: row.materialCode,
        thicknessMm: row.thicknessMm,
        mode: row.mode,
        speedMMin: row.speedMMin,
        pierceS: row.pierceS,
        pricePerM: row.pricePerM,
        pricePerPierce: row.pricePerPierce,
        gas: row.gas,
        minContourMm: row.minContourMm,
        inHouse: row.inHouse,
        supplier: row.supplier,
        machineRateEurH: usesMachineRate ? general.machineRateEurH : null,
        slowContourFactor: slowFactorApplied ? factor : null,
        placeholder: row.placeholder || (usesMachineRate && general.placeholder),
      },
    },
    details: {
      cutLengthMm: m.cutLengthMm,
      slowLengthMm: ctx.slowLengthMm,
      slowCount: ctx.slowContours.length,
      slowFactorApplied,
      /** The length the price is based on: weighted in mode time, plain in mode per_m. */
      adjustedCutLengthMm: slowFactorApplied ? adjustedM * 1000 : m.cutLengthMm,
      pierces,
      speedMMin: row.speedMMin,
      pierceS: row.pierceS,
      cutTimeMin,
      mode: row.mode,
      subcontract,
      reason: laser.reason,
      exactThickness: laser.exactThickness,
      partThicknessMm: thicknessMm,
      rowThicknessMm: row.thicknessMm,
    },
  });
}

/* ─── Sheet material ──────────────────────────────────────── */

function materialLine(ctx: PartContext): OperationLine | null {
  if (ctx.isTubePart) return null;
  const { material, thicknessMm, priceBand, blankMassKg, scrapPct, blank, geometry } = ctx;
  if (!material || thicknessMm === null || !priceBand || blankMassKg === null || scrapPct === null) return null;
  const { width, height } = geometry.measures.bbox;
  if (width <= 0 || height <= 0) return null;
  const unitCost = materialCost(blankMassKg, scrapPct, priceBand.pricePerKg);
  return makeLine(ctx, {
    suffix: "material",
    type: "material",
    label: OPERATION_LABELS.material,
    driverQty: blankMassKg,
    driverUnit: "kg",
    unitCost,
    rateRef: {
      table: "materials",
      key: `${material.code}/<=${priceBand.maxThicknessMm}`,
      values: {
        code: material.code,
        family: material.family,
        densityKgM3: material.densityKgM3,
        pricePerKg: priceBand.pricePerKg,
        bandMaxThicknessMm: priceBand.maxThicknessMm,
        scrapPct,
        scrapPctDefault: material.scrapPctDefault,
        blankMarginMm: blank.marginMm,
        placeholder: material.placeholder,
      },
    },
    details: {
      blankLengthMm: blank.lengthMm,
      blankWidthMm: blank.widthMm,
      blankMarginMm: blank.marginMm,
      bboxWidthMm: width,
      bboxHeightMm: height,
      thicknessMm,
      blankMassKg,
      netMassKg: ctx.netMassKg,
      scrapPct,
      pricePerKg: priceBand.pricePerKg,
    },
  });
}

/* ─── Bending ─────────────────────────────────────────────── */

function bendRateRef(row: BendRate): RateRef {
  return {
    table: "rate_bend",
    key: `${row.thicknessMm}/${row.lengthClassMm}`,
    values: {
      thicknessMm: row.thicknessMm,
      lengthClassMm: row.lengthClassMm,
      pricePerBend: row.pricePerBend,
      setupPerPartType: row.setupPerPartType,
      placeholder: row.placeholder,
    },
  };
}

function bendLines(ctx: PartContext): OperationLine[] {
  const { bends, thicknessMm: t, rates, item, material } = ctx;
  if (bends.length === 0 || t === null) return [];
  const lines: OperationLine[] = [];
  let setupRow: BendRate | null = null;
  for (const bend of bends) {
    if (bend.lengthMm <= 0) continue;
    const row = findBendRate(rates, t, bend.lengthMm);
    if (!row) continue;
    if (!setupRow || row.setupPerPartType > setupRow.setupPerPartType) setupRow = row;
    const forceN =
      material && bend.dieVMm > 0 ? bendForceN(material.rmNmm2, t, bend.lengthMm, bend.dieVMm) : null;
    lines.push(
      makeLine(ctx, {
        suffix: `bend:${bend.id}`,
        type: "bend",
        label: OPERATION_LABELS.bend,
        driverQty: 1,
        driverUnit: "bend",
        unitCost: row.pricePerBend,
        rateRef: bendRateRef(row),
        details: {
          bendId: bend.id,
          lengthMm: bend.lengthMm,
          angleDeg: bend.angleDeg,
          direction: bend.direction,
          radiusMm: bend.radiusMm,
          dieVMm: bend.dieVMm,
          forceN,
          origin: bend.origin,
        },
      })
    );
  }
  if (lines.length > 0 && setupRow) {
    const share = setupShare(setupRow.setupPerPartType, item.qty);
    lines.push(
      makeLine(ctx, {
        suffix: "bend-setup",
        type: "setup",
        label: OPERATION_LABELS.bendSetup,
        driverQty: 1,
        driverUnit: "lot",
        unitCost: share,
        setupShare: share,
        rateRef: bendRateRef(setupRow),
        details: { setup: setupRow.setupPerPartType, qty: item.qty, bendCount: lines.length },
      })
    );
  }
  return lines;
}

/* ─── Rolling ─────────────────────────────────────────────── */

function rollLine(ctx: PartContext): OperationLine | null {
  const roll = ctx.annotations.roll;
  const { thicknessMm: t, rates, item } = ctx;
  if (!roll || t === null) return null;
  const row = findRollRate(rates, t, roll.radiusMm);
  if (!row) return null;
  const axisM = mmToM(roll.axisLengthMm);
  const share = setupShare(row.setup, item.qty);
  return makeLine(ctx, {
    suffix: "roll",
    type: "roll",
    label: OPERATION_LABELS.roll,
    driverQty: axisM,
    driverUnit: "m",
    unitCost: rollCost(row.setup, item.qty, row.pricePerM, axisM),
    setupShare: share,
    rateRef: {
      table: "rate_roll",
      key: `${row.thicknessMm}/${row.radiusClassMm}`,
      values: {
        thicknessMm: row.thicknessMm,
        radiusClassMm: row.radiusClassMm,
        pricePerM: row.pricePerM,
        setup: row.setup,
        placeholder: row.placeholder,
      },
    },
    details: {
      radiusMm: roll.radiusMm,
      axis: roll.axis,
      axisLengthMm: roll.axisLengthMm,
      developedWidthMm: roll.developedWidthMm,
      arcAngleDeg: roll.arcAngleDeg,
      cone: roll.cone !== null,
      setup: row.setup,
      qty: item.qty,
    },
  });
}

/* ─── Welding ─────────────────────────────────────────────── */

export function weldRateRef(row: WeldRate): RateRef {
  return {
    table: "rate_weld",
    key: `${row.process}/${row.beadMm}`,
    values: {
      process: row.process,
      beadMm: row.beadMm,
      pricePerMm: row.pricePerMm,
      setup: row.setup,
      minOrder: row.minOrder,
      placeholder: row.placeholder,
    },
  };
}

function weldLines(ctx: PartContext): OperationLine[] {
  const { annotations, rates, item } = ctx;
  if (annotations.welds.length === 0) return [];
  const lines: OperationLine[] = [];
  const processRows = new Map<WeldProcess, WeldRate>();
  for (const weld of annotations.welds) {
    const row = findWeldRate(rates, weld.process, weld.beadMm);
    if (!row) continue;
    const stitch = weld.pattern === "stitch" ? (weld.stitch ?? rates.general.defaultStitch) : null;
    const effective = weldEffectiveLengthMm(weld.lengthMm, weld.pattern, stitch, weld.sides);
    if (!processRows.has(weld.process)) processRows.set(weld.process, row);
    lines.push(
      makeLine(ctx, {
        suffix: `weld:${weld.id}`,
        type: "weld",
        label: OPERATION_LABELS.weld,
        driverQty: effective,
        driverUnit: "mm",
        unitCost: weldCost(effective, row.pricePerMm),
        rateRef: weldRateRef(row),
        details: {
          weldId: weld.id,
          process: weld.process,
          beadMm: weld.beadMm,
          pattern: weld.pattern,
          beadLengthMm: stitch?.beadLengthMm ?? null,
          pitchMm: stitch?.pitchMm ?? null,
          sides: weld.sides,
          lengthMm: weld.lengthMm,
          effectiveLengthMm: effective,
          storedEffectiveLengthMm: weld.effectiveLengthMm,
        },
      })
    );
  }
  for (const [process, row] of processRows) {
    const share = setupShare(row.setup, item.qty);
    lines.push(
      makeLine(ctx, {
        suffix: `weld-setup:${process}`,
        type: "setup",
        label: OPERATION_LABELS.weldSetup,
        driverQty: 1,
        driverUnit: "lot",
        unitCost: share,
        setupShare: share,
        rateRef: weldRateRef(row),
        details: { process, setup: row.setup, qty: item.qty },
      })
    );
  }
  return lines;
}

/* ─── Threads ─────────────────────────────────────────────── */

function threadLines(ctx: PartContext): OperationLine[] {
  const lines: OperationLine[] = [];
  for (const group of ctx.confirmedThreads) {
    const row = findThreadRate(ctx.rates, group.size);
    if (!row) continue;
    const count = group.loopIds.length;
    lines.push(
      makeLine(ctx, {
        suffix: `thread:${normaliseThreadSize(group.size)}`,
        type: "thread",
        label: row.size,
        driverQty: count,
        driverUnit: "each",
        unitCost: countCost(count, row.priceEach),
        rateRef: {
          table: "rate_thread",
          key: row.size,
          values: { size: row.size, priceEach: row.priceEach, placeholder: row.placeholder },
        },
        details: { size: row.size, count, loopIds: group.loopIds.join(",") },
      })
    );
  }
  return lines;
}

/* ─── Extras (user-added) ─────────────────────────────────── */

function extraLines(ctx: PartContext): OperationLine[] {
  const { item, rates, geometry } = ctx;
  const general = rates.general;
  const lines: OperationLine[] = [];
  item.extras.forEach((extra, index) => {
    switch (extra.type) {
      case "feature": {
        const row = findFeatureRate(rates, extra.code);
        if (!row) return;
        lines.push(
          makeLine(ctx, {
            suffix: `feature:${index}`,
            type: "feature",
            label: row.name,
            driverQty: extra.count,
            driverUnit: "each",
            unitCost: countCost(extra.count, row.priceEach),
            auto: false,
            rateRef: {
              table: "rate_feature",
              key: row.code,
              values: { code: row.code, name: row.name, priceEach: row.priceEach, placeholder: row.placeholder },
            },
            details: { code: row.code, count: extra.count },
          })
        );
        return;
      }
      case "machining": {
        lines.push(
          makeLine(ctx, {
            suffix: `machining:${index}`,
            type: "machining",
            label: OPERATION_LABELS.machining,
            driverQty: extra.minutes,
            driverUnit: "min",
            unitCost: machiningCost(extra.minutes, general.machiningRateEurH),
            auto: false,
            notes: extra.note,
            rateRef: {
              table: "rate_general",
              key: "machining_rate_eur_h",
              values: { machiningRateEurH: general.machiningRateEurH, placeholder: general.placeholder },
            },
            details: { minutes: extra.minutes },
          })
        );
        return;
      }
      case "finish": {
        const rate = findFinishRate(rates, extra.code);
        if (!rate) return;
        const finish = computeFinish(
          rate,
          {
            netAreaMm2: geometry.measures.netAreaMm2,
            massKg: ctx.netMassKg,
            cutLengthMm: geometry.measures.cutLengthMm,
          },
          extra.maskingMinutes,
          item.qty,
          general
        );
        if (!finish) return;
        lines.push(
          makeLine(ctx, {
            suffix: `finish:${index}`,
            type: finish.type,
            label: rate.name,
            driverQty: finish.driverQty,
            driverUnit: finish.driverUnit,
            unitCost: finish.unitCost,
            auto: false,
            notes: extra.note,
            rateRef: {
              table: "rate_finish",
              key: rate.code,
              values: {
                code: rate.code,
                unit: rate.unit,
                price: rate.price,
                minimum: rate.minimum,
                labourRateEurH: extra.maskingMinutes > 0 ? general.labourRateEurH : null,
                placeholder: rate.placeholder || (extra.maskingMinutes > 0 && general.placeholder),
              },
            },
            details: {
              code: rate.code,
              maskingMinutes: extra.maskingMinutes,
              maskingCost: finish.maskingCost,
              unitCostBeforeMinimum: finish.unitCostBeforeMinimum,
              minimumApplied: finish.minimumApplied,
              batchCost: finish.batchCost,
              minimum: rate.minimum,
              qty: item.qty,
            },
          })
        );
        return;
      }
      case "tube_cut": {
        if (extra.pricePerMTube !== null) {
          lines.push(
            makeLine(ctx, {
              suffix: `tube-material:${index}`,
              type: "material",
              label: OPERATION_LABELS.materialTube,
              driverQty: extra.metres,
              driverUnit: "m",
              unitCost: extra.metres * extra.pricePerMTube,
              auto: false,
              rateRef: {
                table: "manual",
                key: "tube_price_per_m",
                values: { pricePerMTube: extra.pricePerMTube, placeholder: false },
              },
              details: { profileFamily: extra.profileFamily, wallMm: extra.wallMm, metres: extra.metres },
            })
          );
        }
        const row = findTubeLaserRate(rates, extra.profileFamily, extra.wallMm);
        if (!row) return;
        const cutM = mmToM(extra.cutLengthMm);
        const share = setupShare(row.setup, item.qty);
        lines.push(
          makeLine(ctx, {
            suffix: `tube:${index}`,
            type: "tube_cut",
            label: OPERATION_LABELS.tubeCut,
            driverQty: cutM,
            driverUnit: "m",
            unitCost: row.pricePerMCut * cutM + row.handlingPerPart + share,
            setupShare: share,
            auto: false,
            rateRef: {
              table: "rate_tube_laser",
              key: `${row.profileFamily}/${row.wallMm}`,
              values: {
                profileFamily: row.profileFamily,
                wallMm: row.wallMm,
                pricePerMCut: row.pricePerMCut,
                handlingPerPart: row.handlingPerPart,
                setup: row.setup,
                placeholder: row.placeholder,
              },
            },
            details: {
              profileFamily: extra.profileFamily,
              wallMm: extra.wallMm,
              cutLengthMm: extra.cutLengthMm,
              metres: extra.metres,
              handlingPerPart: row.handlingPerPart,
              setup: row.setup,
              qty: item.qty,
            },
          })
        );
        return;
      }
      case "other": {
        lines.push(
          makeLine(ctx, {
            suffix: `other:${index}`,
            type: "other",
            label: extra.label,
            driverQty: 1,
            driverUnit: "each",
            unitCost: extra.unitCost,
            auto: false,
            rateRef: { table: "manual", key: "other", values: { unitCost: extra.unitCost, placeholder: false } },
            details: {},
          })
        );
        return;
      }
      case "handling": {
        lines.push(
          makeLine(ctx, {
            suffix: `handling:${index}`,
            type: "handling",
            label: OPERATION_LABELS.handling,
            driverQty: 1,
            driverUnit: "part",
            unitCost: extra.unitCost,
            auto: false,
            rateRef: { table: "manual", key: "handling", values: { unitCost: extra.unitCost, placeholder: false } },
            details: {},
          })
        );
        return;
      }
    }
  });
  return lines;
}

/* ─── Engraving ───────────────────────────────────────────── */

function engraveLine(ctx: PartContext): OperationLine | null {
  const lengthMm = ctx.geometry.measures.engraveLengthMm;
  if (lengthMm <= 0) return null;
  const rate = findFinishRate(ctx.rates, OPERATION_LABELS.engrave);
  if (!rate || rate.unit !== "m") return null;
  const lengthM = mmToM(lengthMm);
  const applied = applyBatchMinimum(engraveCost(lengthM, rate.price), ctx.item.qty, rate.minimum);
  return makeLine(ctx, {
    suffix: "engrave",
    type: "engrave",
    label: OPERATION_LABELS.engrave,
    driverQty: lengthM,
    driverUnit: "m",
    unitCost: applied.unitCost,
    rateRef: {
      table: "rate_finish",
      key: rate.code,
      values: { code: rate.code, unit: rate.unit, price: rate.price, minimum: rate.minimum, placeholder: rate.placeholder },
    },
    details: { engraveLengthMm: lengthMm, minimumApplied: applied.applied, batchCost: applied.batchCost },
  });
}

/* ─── Public API ──────────────────────────────────────────── */

/** Operation lines + feasibility flags for an already-built context. */
export function buildContextOperations(ctx: PartContext): ItemOperations {
  const operations: OperationLine[] = [];
  const push = (line: OperationLine | null): void => {
    if (line) operations.push(line);
  };
  push(laserLine(ctx));
  push(materialLine(ctx));
  operations.push(...bendLines(ctx));
  push(rollLine(ctx));
  operations.push(...weldLines(ctx));
  operations.push(...threadLines(ctx));
  operations.push(...extraLines(ctx));
  push(engraveLine(ctx));
  return { operations, flags: evaluateContextFlags(ctx) };
}

/**
 * Operation lines + feasibility flags for one part × item. Pure. Throws
 * PricingError ("invalid_qty" / "invalid_input") for a qty ≤ 0 or any
 * non-finite / negative user number (validated in buildPartContext).
 */
export function buildItemOperations(
  part: PricingPart,
  item: PricingItem,
  rates: RateSnapshot,
  machines: MachinePark
): ItemOperations {
  return buildContextOperations(buildPartContext(part, item, rates, machines));
}
