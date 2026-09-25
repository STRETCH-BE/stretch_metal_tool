/**
 * Pricing engine — feasibility rules (build prompt Step 9, spec §8) that
 * turn a part + item + rate snapshot + machine park into Flags.
 * File path: /lib/pricing/feasibility.ts
 *
 * Severity contract (types.ts): red blocks sending, amber needs a
 * confirmation or an approved override (overridable = true), green is
 * information. Every flag carries `params` for the localized message in
 * content/flags.ts; the catalogue with params is in lib/pricing/README.md.
 *
 * Decisions that are not spelled out in the spec:
 * - Amber triage states are suppressed once the user answered them
 *   (units confirmed, forming chosen, every bend candidate given a role);
 *   the geometry engine may also re-triage to green, either way works.
 * - Hole checks are aggregated per bend line (one red for the crossing
 *   holes, one amber for the near ones, with the smallest distance and
 *   the loop ids) rather than one flag per hole, so overrides stay per
 *   rule and part.
 * - The flat-laser bed check only runs for in-house cutting; a
 *   subcontracted cut is bounded by the supplier, not our bed.
 * - Tube limits that need data the extra does not carry (envelope,
 *   circumscribed circle, kg/m) are checked only when the optional fields
 *   are filled in; wall and length are always checked.
 * - The rate for a bend/roll is looked up with the same functions the
 *   operations builder uses, so "no_rate_row" and "line omitted" agree.
 * - EVERY `*.no_rate_row` is red, bend and roll included: the operations
 *   builder omits the line, so an amber (overridable) flag would let an
 *   approved override send the bends or the rolling at 0 € (review
 *   finding). Adding the row is the admin's fix, not an override.
 * - `laser.slow_contours` (green) is raised only when the slow factor is
 *   actually applied, i.e. the priced row is mode "time"; a per-metre row
 *   (in-house or supplier) prices the plain length (Step 9).
 * - User-typed numbers are validated in buildPartContext (validate.ts):
 *   evaluatePartFlags throws PricingError("invalid_input") for NaN /
 *   Infinity / negative extras and annotations instead of skipping rules.
 */

import { flangeLengthsMm, holeEdgeToBendMm } from "./bend-checks";
import { buildPartContext, type PartContext } from "./context";
import { computeFinish } from "./finish";
import { bendForceN, minFlangeMm, minHoleToBendMm } from "./formulas";
import { OPERATION_LABELS } from "./labels";
import {
  findBendRate,
  findFeatureRate,
  findFinishRate,
  findRollRate,
  findThreadRate,
  findTubeLaserRate,
  findWeldRate,
} from "./lookup";
import type {
  Flag,
  FlagCode,
  FlagSeverity,
  MachinePark,
  PricedQuote,
  PricingItem,
  PricingPart,
  RateSnapshot,
} from "./types";
import type { Point } from "../geometry/types";

const EPS = 1e-9;

type Params = Record<string, number | string | null | undefined>;

function cleanParams(params: Params): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

function partFlag(ctx: PartContext, code: FlagCode, severity: FlagSeverity, params: Params = {}): Flag {
  return {
    code,
    severity,
    partId: ctx.part.id,
    itemId: ctx.item.id,
    params: cleanParams(params),
    overridable: severity === "amber",
  };
}

function quoteFlag(code: FlagCode, severity: FlagSeverity, params: Params = {}): Flag {
  return {
    code,
    severity,
    partId: null,
    itemId: null,
    params: cleanParams(params),
    overridable: severity === "amber",
  };
}

/* ─── Geometry / intake ───────────────────────────────────── */

function geometryFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const { part, geometry, annotations } = ctx;
  if (part.source === "manual") flags.push(partFlag(ctx, "geometry.manual", "amber"));

  const { state, candidateEntityIds } = geometry.triage;
  if (state === "amber_units") {
    if (!annotations.unitsConfirmed) {
      flags.push(partFlag(ctx, "geometry.units_unconfirmed", "amber", { state }));
    }
  } else if (state === "amber_forming_unknown") {
    if (annotations.forming === null) {
      flags.push(partFlag(ctx, "geometry.triage_amber", "amber", { state }));
    }
  } else if (state === "amber_bend_candidates") {
    const unanswered = candidateEntityIds.filter((id) => !annotations.entities[id]);
    if (candidateEntityIds.length === 0 || unanswered.length > 0) {
      flags.push(
        partFlag(ctx, "geometry.triage_amber", "amber", {
          state,
          count: unanswered.length || candidateEntityIds.length,
        })
      );
    }
  } else if (state.startsWith("red_")) {
    flags.push(partFlag(ctx, "geometry.triage_red", "red", { state }));
  }

  if (!ctx.material) {
    flags.push(partFlag(ctx, "geometry.no_material", "red", { code: part.materialCode ?? "" }));
  }
  if (ctx.thicknessMm === null) flags.push(partFlag(ctx, "geometry.no_thickness", "red"));
  return flags;
}

/* ─── Flat laser ──────────────────────────────────────────── */

function laserFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const { laser, thicknessMm, material, family, flatLaser } = ctx;
  if (!laser || thicknessMm === null || !material || ctx.geometry.measures.cutLengthMm <= 0) {
    return flags;
  }
  const supplier = laser.row?.supplier ?? null;
  const rowThicknessMm = laser.row?.thicknessMm ?? null;

  if (!laser.row) {
    flags.push(
      partFlag(ctx, "laser.no_rate_row", "red", {
        materialCode: material.code,
        thicknessMm,
        limitMm: laser.limitMm,
        family,
        reason: laser.reason,
      })
    );
  } else if (laser.subcontract) {
    if (laser.reason === "over_limit") {
      flags.push(
        partFlag(ctx, "laser.thickness_over_limit", "amber", {
          limitMm: laser.limitMm,
          thicknessMm,
          family,
          rowThicknessMm,
          supplier,
        })
      );
    } else {
      flags.push(
        partFlag(ctx, "laser.subcontract", "amber", {
          thicknessMm,
          rowThicknessMm,
          supplier,
          reason: laser.reason,
        })
      );
    }
  } else if (flatLaser) {
    const { bedLengthMm, bedWidthMm, edgeMarginMm } = flatLaser.limits;
    const usableL = bedLengthMm - 2 * edgeMarginMm;
    const usableW = bedWidthMm - 2 * edgeMarginMm;
    const { lengthMm: bl, widthMm: bw } = ctx.blank;
    const fits =
      (bl <= usableL + EPS && bw <= usableW + EPS) || (bl <= usableW + EPS && bw <= usableL + EPS);
    if (!fits) {
      flags.push(
        partFlag(ctx, "laser.blank_exceeds_bed", "red", {
          blankLengthMm: bl,
          blankWidthMm: bw,
          bedLengthMm,
          bedWidthMm,
          edgeMarginMm,
          machine: flatLaser.code,
        })
      );
    }
  }

  if (laser.row && laser.row.mode === "time" && ctx.slowContours.length > 0) {
    flags.push(
      partFlag(ctx, "laser.slow_contours", "green", {
        count: ctx.slowContours.length,
        factor: ctx.rates.general.slowContourFactor,
        lengthMm: ctx.slowLengthMm,
        thresholdMm: laser.row.minContourMm ?? undefined,
      })
    );
  }
  return flags;
}

/* ─── Material ────────────────────────────────────────────── */

function materialFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const { material, thicknessMm, priceBand, netMassKg, rates } = ctx;
  if (!material || thicknessMm === null) return flags;
  if (!priceBand && !ctx.isTubePart) {
    flags.push(partFlag(ctx, "material.no_price", "red", { code: material.code, thicknessMm }));
  }
  if (netMassKg !== null && netMassKg > rates.general.handlingMassLimitKg) {
    flags.push(
      partFlag(ctx, "material.mass_handling", "green", {
        massKg: netMassKg,
        limitKg: rates.general.handlingMassLimitKg,
        surchargeEur: rates.general.handlingSurchargeEur,
      })
    );
  }
  return flags;
}

/* ─── Press brake ─────────────────────────────────────────── */

function outlinePoints(ctx: PartContext): Point[] {
  const { geometry } = ctx;
  const outer = geometry.loops.find((l) => l.id === geometry.outerLoopId);
  if (outer && outer.points.length > 0) return outer.points;
  const { minX, minY, maxX, maxY, width, height } = geometry.measures.bbox;
  if (width <= 0 && height <= 0) return [];
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function bendFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const { bends, thicknessMm: t, material, pressBrake, holes, rates } = ctx;
  if (bends.length === 0) return flags;
  const outline = outlinePoints(ctx);

  for (const bend of bends) {
    if (bend.lengthMm <= 0) continue;
    const bendId = bend.id;

    if (pressBrake && t !== null && material && bend.dieVMm > 0) {
      const forceN = bendForceN(material.rmNmm2, t, bend.lengthMm, bend.dieVMm);
      const limitN = pressBrake.limits.forceKN * 1000;
      if (forceN > limitN + EPS) {
        flags.push(
          partFlag(ctx, "bend.force_over_limit", "red", {
            bendId,
            forceKN: forceN / 1000,
            limitKN: pressBrake.limits.forceKN,
            lengthMm: bend.lengthMm,
            thicknessMm: t,
            dieVMm: bend.dieVMm,
            rmNmm2: material.rmNmm2,
          })
        );
      }
    }

    if (pressBrake && bend.lengthMm > pressBrake.limits.bendLengthMm + EPS) {
      flags.push(
        partFlag(ctx, "bend.length_over_limit", "red", {
          bendId,
          lengthMm: bend.lengthMm,
          limitMm: pressBrake.limits.bendLengthMm,
        })
      );
    }

    if (t !== null) {
      const minMm = minHoleToBendMm(t);
      const crossing: string[] = [];
      const near: string[] = [];
      let nearest = Number.POSITIVE_INFINITY;
      for (const hole of holes) {
        const distance = holeEdgeToBendMm(bend, hole.center, hole.diameterMm / 2);
        if (distance === null) continue;
        if (distance < -EPS) {
          crossing.push(hole.loopId);
        } else if (distance < minMm - EPS) {
          near.push(hole.loopId);
          nearest = Math.min(nearest, distance);
        }
      }
      if (crossing.length > 0) {
        flags.push(
          partFlag(ctx, "bend.hole_crosses_bend", "red", {
            bendId,
            count: crossing.length,
            loopIds: crossing.join(","),
          })
        );
      }
      if (near.length > 0) {
        flags.push(
          partFlag(ctx, "bend.hole_near_bend", "amber", {
            bendId,
            count: near.length,
            distanceMm: nearest,
            minMm,
            loopIds: near.join(","),
          })
        );
      }
    }

    if (t !== null && bend.dieVMm > 0 && outline.length > 0) {
      const flange = flangeLengthsMm(bend, outline, bends.filter((b) => b !== bend));
      if (flange) {
        const minMm = minFlangeMm(bend.dieVMm, bend.radiusMm);
        if (flange.smaller < minMm - EPS) {
          flags.push(
            partFlag(ctx, "bend.short_flange", "amber", {
              bendId,
              flangeMm: flange.smaller,
              minMm,
              dieVMm: bend.dieVMm,
              radiusMm: bend.radiusMm,
            })
          );
        }
      }
    }

    if (t !== null && !findBendRate(rates, t, bend.lengthMm)) {
      flags.push(
        partFlag(ctx, "bend.no_rate_row", "red", { bendId, thicknessMm: t, lengthMm: bend.lengthMm })
      );
    }
  }
  return flags;
}

/* ─── Rolling ─────────────────────────────────────────────── */

function rollFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const roll = ctx.annotations.roll;
  if (!roll) return flags;
  const { rollMachine, thicknessMm: t, rates } = ctx;
  if (rollMachine) {
    const { minRadiusMm, maxWidthMm, maxThicknessMm } = rollMachine.limits;
    if (roll.radiusMm < minRadiusMm - EPS) {
      flags.push(partFlag(ctx, "roll.radius_too_small", "red", { radiusMm: roll.radiusMm, minRadiusMm }));
    }
    if (roll.axisLengthMm > maxWidthMm + EPS) {
      flags.push(
        partFlag(ctx, "roll.axis_too_long", "red", { axisLengthMm: roll.axisLengthMm, maxWidthMm })
      );
    }
    if (t !== null && t > maxThicknessMm + EPS) {
      flags.push(
        partFlag(ctx, "roll.thickness_over_limit", "red", { thicknessMm: t, maxThicknessMm })
      );
    }
  }
  if (t !== null && !findRollRate(rates, t, roll.radiusMm)) {
    flags.push(partFlag(ctx, "roll.no_rate_row", "red", { thicknessMm: t, radiusMm: roll.radiusMm }));
  }
  return flags;
}

/* ─── Welding ─────────────────────────────────────────────── */

function weldFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  for (const weld of ctx.annotations.welds) {
    if (!findWeldRate(ctx.rates, weld.process, weld.beadMm)) {
      flags.push(
        partFlag(ctx, "weld.no_rate_row", "red", {
          weldId: weld.id,
          process: weld.process,
          beadMm: weld.beadMm,
        })
      );
    }
  }
  return flags;
}

/* ─── Tube laser ──────────────────────────────────────────── */

function tubeFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const { tubeLaser, family, rates } = ctx;
  ctx.item.extras.forEach((extra, index) => {
    if (extra.type !== "tube_cut") return;
    const base = { index, profileFamily: extra.profileFamily };
    if (tubeLaser) {
      const lim = tubeLaser.limits;
      const lengthMm = extra.metres * 1000;
      if (lengthMm > lim.maxLengthMm + EPS) {
        flags.push(
          partFlag(ctx, "tube.over_limit", "red", { ...base, what: "length", value: lengthMm, limit: lim.maxLengthMm })
        );
      }
      if (family) {
        const [modeA, modeB] = lim.wallThicknessMm[family];
        const wallLimit = Math.min(modeA, modeB);
        if (extra.wallMm > wallLimit + EPS) {
          flags.push(
            partFlag(ctx, "tube.over_limit", "red", { ...base, what: "wall", value: extra.wallMm, limit: wallLimit, family })
          );
        }
      }
      if (extra.envelopeMm !== null && extra.envelopeMm !== undefined) {
        const limit = extra.profileFamily === "round" ? lim.maxRoundDiameterMm : lim.maxRectSideMm;
        if (extra.envelopeMm > limit + EPS) {
          flags.push(
            partFlag(ctx, "tube.over_limit", "red", { ...base, what: "envelope", value: extra.envelopeMm, limit })
          );
        }
      }
      if (
        extra.circumscribedMm !== null &&
        extra.circumscribedMm !== undefined &&
        extra.circumscribedMm > lim.maxCircumscribedMm + EPS
      ) {
        flags.push(
          partFlag(ctx, "tube.over_limit", "red", { ...base, what: "circumscribed", value: extra.circumscribedMm, limit: lim.maxCircumscribedMm })
        );
      }
      if (extra.kgPerM !== null && extra.kgPerM !== undefined) {
        if (extra.kgPerM > lim.maxKgPerM + EPS) {
          flags.push(
            partFlag(ctx, "tube.over_limit", "red", { ...base, what: "kg_per_m", value: extra.kgPerM, limit: lim.maxKgPerM })
          );
        }
        const rawKg = extra.kgPerM * extra.metres;
        if (rawKg > lim.maxRawWeightKg + EPS) {
          flags.push(
            partFlag(ctx, "tube.over_limit", "red", { ...base, what: "raw_weight", value: rawKg, limit: lim.maxRawWeightKg })
          );
        }
      }
    }
    if (!findTubeLaserRate(rates, extra.profileFamily, extra.wallMm)) {
      flags.push(partFlag(ctx, "tube.no_rate_row", "red", { ...base, wallMm: extra.wallMm }));
    }
  });
  return flags;
}

/* ─── Threads, features, finishes ─────────────────────────── */

function threadFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  for (const group of ctx.confirmedThreads) {
    if (!findThreadRate(ctx.rates, group.size)) {
      flags.push(
        partFlag(ctx, "thread.no_rate_row", "red", { size: group.size, count: group.loopIds.length })
      );
    }
  }
  return flags;
}

function extraFlags(ctx: PartContext): Flag[] {
  const flags: Flag[] = [];
  const { rates, geometry, item } = ctx;
  item.extras.forEach((extra, index) => {
    if (extra.type === "feature") {
      if (!findFeatureRate(rates, extra.code)) {
        flags.push(partFlag(ctx, "feature.no_rate_row", "red", { code: extra.code, index }));
      }
    } else if (extra.type === "finish") {
      const rate = findFinishRate(rates, extra.code);
      if (!rate) {
        flags.push(partFlag(ctx, "finish.no_rate_row", "red", { code: extra.code, index }));
        return;
      }
      const finish = computeFinish(
        rate,
        {
          netAreaMm2: geometry.measures.netAreaMm2,
          massKg: ctx.netMassKg,
          cutLengthMm: geometry.measures.cutLengthMm,
        },
        extra.maskingMinutes,
        item.qty,
        rates.general
      );
      if (finish?.minimumApplied) {
        flags.push(
          partFlag(ctx, "finish.minimum_applied", "green", {
            code: rate.code,
            minimum: rate.minimum,
            batchCost: finish.batchCost,
            batchBefore: finish.unitCostBeforeMinimum * item.qty,
            index,
          })
        );
      }
    }
  });
  if (geometry.measures.engraveLengthMm > 0 && !findFinishRate(rates, OPERATION_LABELS.engrave)) {
    flags.push(partFlag(ctx, "finish.no_rate_row", "red", { code: OPERATION_LABELS.engrave }));
  }
  return flags;
}

/* ─── Public API ──────────────────────────────────────────── */

/** All part-level flags for an already-built context (used by the operations builder). */
export function evaluateContextFlags(ctx: PartContext): Flag[] {
  return [
    ...geometryFlags(ctx),
    ...laserFlags(ctx),
    ...materialFlags(ctx),
    ...bendFlags(ctx),
    ...rollFlags(ctx),
    ...weldFlags(ctx),
    ...tubeFlags(ctx),
    ...threadFlags(ctx),
    ...extraFlags(ctx),
  ];
}

/** Every feasibility rule for one part × item. Pure. */
export function evaluatePartFlags(
  part: PricingPart,
  item: PricingItem,
  rates: RateSnapshot,
  machines: MachinePark
): Flag[] {
  return evaluateContextFlags(buildPartContext(part, item, rates, machines));
}

function numberParam(value: number | string | boolean | null | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Quote-level flags computed from the priced result. */
export function evaluateQuoteFlags(priced: Pick<PricedQuote, "items" | "welding">): Flag[] {
  const flags: Flag[] = [];
  const operations = [
    ...priced.items.flatMap((item) => item.operations),
    ...(priced.welding?.operations ?? []),
  ];
  const placeholders = operations.filter((op) => op.rateRef.values.placeholder === true);
  if (placeholders.length > 0) {
    flags.push(quoteFlag("rates.placeholder", "green", { count: placeholders.length }));
  }
  if (priced.welding?.minOrderApplied) {
    const line = priced.welding.operations.find((op) => op.label === OPERATION_LABELS.weldMinOrder);
    flags.push(
      quoteFlag("weld.min_order_applied", "green", {
        minOrder: numberParam(line?.details.minOrder),
        shortfall: numberParam(line?.details.shortfall),
        totalBefore: numberParam(line?.details.totalBefore),
      })
    );
  }
  return flags;
}
