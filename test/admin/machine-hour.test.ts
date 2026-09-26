/**
 * Machine-hour model against hand-computed numbers.
 * File path: /test/admin/machine-hour.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_MACHINE_HOUR_INPUTS,
  coerceMachineHourInputs,
  computeMachineHour,
  type MachineHourInputs,
} from "@/lib/admin/machine-hour";

const LASER: MachineHourInputs = {
  purchasePrice: 500_000,
  residualValue: 50_000,
  usefulLifeYears: 10,
  productiveHoursPerYear: 1500,
  serviceEurPerYear: 12_000,
  otherFixedEurPerYear: 6_000,
  powerKw: 60,
  utilisationPct: 50,
  energyPriceEurPerKwh: 0.18,
  gasEurPerHour: 8,
  operatorEurPerHour: 40,
  operatorSharePct: 50,
  toolingEurPerYear: 3_000,
  overheadPct: 15,
};

describe("computeMachineHour", () => {
  it("matches the hand-computed breakdown", () => {
    const r = computeMachineHour(LASER);
    // (500 000 − 50 000) / 10 y / 1 500 h = 30 €/h
    expect(r.depreciation).toBeCloseTo(30, 10);
    expect(r.service).toBeCloseTo(8, 10); // 12 000 / 1 500
    expect(r.fixed).toBeCloseTo(4, 10); // 6 000 / 1 500
    expect(r.energy).toBeCloseTo(5.4, 10); // 60 kW × 50 % × 0.18
    expect(r.gas).toBe(8);
    expect(r.operator).toBeCloseTo(20, 10); // 40 × 50 %
    expect(r.tooling).toBeCloseTo(2, 10); // 3 000 / 1 500
    expect(r.subtotal).toBeCloseTo(77.4, 10);
    expect(r.overhead).toBeCloseTo(11.61, 10); // 15 % of 77.4
    expect(r.total).toBeCloseTo(89.01, 10);
    expect(r.valid).toBe(true);
  });

  it("sums the seven items into the subtotal and adds overhead", () => {
    const r = computeMachineHour(LASER);
    const items = r.depreciation + r.service + r.fixed + r.energy + r.gas + r.operator + r.tooling;
    expect(r.subtotal).toBeCloseTo(items, 10);
    expect(r.total).toBeCloseTo(r.subtotal + r.overhead, 10);
  });

  it("zero productive hours: yearly items are 0, hourly items stay, valid is false", () => {
    const r = computeMachineHour({ ...LASER, productiveHoursPerYear: 0 });
    expect(r.valid).toBe(false);
    expect(r.depreciation).toBe(0);
    expect(r.service).toBe(0);
    expect(r.fixed).toBe(0);
    expect(r.tooling).toBe(0);
    expect(r.energy).toBeCloseTo(5.4, 10);
    expect(r.gas).toBe(8);
    expect(r.operator).toBeCloseTo(20, 10);
    expect(r.subtotal).toBeCloseTo(33.4, 10);
    expect(r.total).toBeCloseTo(33.4 * 1.15, 10);
    expect(Number.isFinite(r.total)).toBe(true);
  });

  it("zero useful life: no depreciation, still finite", () => {
    const r = computeMachineHour({ ...LASER, usefulLifeYears: 0 });
    expect(r.valid).toBe(false);
    expect(r.depreciation).toBe(0);
    expect(Number.isFinite(r.total)).toBe(true);
  });

  it("non-finite inputs are treated as 0", () => {
    const r = computeMachineHour({ ...LASER, gasEurPerHour: Number.NaN, powerKw: Number.POSITIVE_INFINITY });
    expect(r.gas).toBe(0);
    expect(r.energy).toBe(0);
  });

  it("empty inputs give an all-zero, invalid result", () => {
    const r = computeMachineHour(EMPTY_MACHINE_HOUR_INPUTS);
    expect(r.total).toBe(0);
    expect(r.valid).toBe(false);
  });
});

describe("coerceMachineHourInputs", () => {
  it("reads numbers and numeric strings, defaults the rest to 0", () => {
    const inputs = coerceMachineHourInputs({ purchasePrice: "1200.5", powerKw: 12, overheadPct: "abc", extra: 1 });
    expect(inputs.purchasePrice).toBe(1200.5);
    expect(inputs.powerKw).toBe(12);
    expect(inputs.overheadPct).toBe(0);
    expect(inputs.gasEurPerHour).toBe(0);
    expect("extra" in inputs).toBe(false);
  });

  it("tolerates garbage", () => {
    expect(coerceMachineHourInputs(null)).toEqual(EMPTY_MACHINE_HOUR_INPUTS);
    expect(coerceMachineHourInputs("x")).toEqual(EMPTY_MACHINE_HOUR_INPUTS);
  });
});
