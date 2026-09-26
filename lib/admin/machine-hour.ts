/**
 * Machine-hour cost model (spec section 13) — purchase price, residual,
 * useful life, productive hours, service, other fixed costs, energy, gas,
 * operator share, tooling and overhead → cost per hour with a breakdown.
 * File path: /lib/admin/machine-hour.ts
 *
 * Pure and unit-tested (test/admin/machine-hour.test.ts). All money in
 * EUR. Per-hour items divide the yearly figures by the productive hours;
 * when the hours are not a positive number every yearly item is 0 and
 * `valid` is false (the UI shows a notice instead of Infinity). Overhead
 * is a percentage on top of the subtotal of all other items. Nothing is
 * rounded here — the display rounds.
 */

export type MachineHourInputs = {
  /** Purchase price EUR. */
  purchasePrice: number;
  /** Residual value EUR at the end of the useful life. */
  residualValue: number;
  usefulLifeYears: number;
  productiveHoursPerYear: number;
  serviceEurPerYear: number;
  otherFixedEurPerYear: number;
  /** Connected load kW. */
  powerKw: number;
  /** Share of the connected load actually drawn (0–100). */
  utilisationPct: number;
  energyPriceEurPerKwh: number;
  gasEurPerHour: number;
  /** Full operator cost EUR/h (wage + on-costs). */
  operatorEurPerHour: number;
  /** Share of the operator's time booked to this machine (0–100). */
  operatorSharePct: number;
  toolingEurPerYear: number;
  overheadPct: number;
};

export type MachineHourBreakdown = {
  depreciation: number;
  service: number;
  fixed: number;
  energy: number;
  gas: number;
  operator: number;
  tooling: number;
  /** Sum of the seven items above. */
  subtotal: number;
  overhead: number;
  /** subtotal + overhead — the machine rate EUR/h. */
  total: number;
  /** False when productive hours or useful life are not > 0. */
  valid: boolean;
};

export const MACHINE_HOUR_FIELDS: readonly (keyof MachineHourInputs)[] = [
  "purchasePrice",
  "residualValue",
  "usefulLifeYears",
  "productiveHoursPerYear",
  "serviceEurPerYear",
  "otherFixedEurPerYear",
  "powerKw",
  "utilisationPct",
  "energyPriceEurPerKwh",
  "gasEurPerHour",
  "operatorEurPerHour",
  "operatorSharePct",
  "toolingEurPerYear",
  "overheadPct",
];

export const EMPTY_MACHINE_HOUR_INPUTS: MachineHourInputs = {
  purchasePrice: 0,
  residualValue: 0,
  usefulLifeYears: 0,
  productiveHoursPerYear: 0,
  serviceEurPerYear: 0,
  otherFixedEurPerYear: 0,
  powerKw: 0,
  utilisationPct: 0,
  energyPriceEurPerKwh: 0,
  gasEurPerHour: 0,
  operatorEurPerHour: 0,
  operatorSharePct: 0,
  toolingEurPerYear: 0,
  overheadPct: 0,
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function computeMachineHour(input: MachineHourInputs): MachineHourBreakdown {
  const hours = finite(input.productiveHoursPerYear);
  const life = finite(input.usefulLifeYears);
  const valid = hours > 0 && life > 0;
  const perHour = (yearly: number): number => (hours > 0 ? finite(yearly) / hours : 0);

  const depreciation =
    valid ? (finite(input.purchasePrice) - finite(input.residualValue)) / life / hours : 0;
  const service = perHour(input.serviceEurPerYear);
  const fixed = perHour(input.otherFixedEurPerYear);
  const energy =
    finite(input.powerKw) * (finite(input.utilisationPct) / 100) * finite(input.energyPriceEurPerKwh);
  const gas = finite(input.gasEurPerHour);
  const operator = finite(input.operatorEurPerHour) * (finite(input.operatorSharePct) / 100);
  const tooling = perHour(input.toolingEurPerYear);
  const subtotal = depreciation + service + fixed + energy + gas + operator + tooling;
  const overhead = subtotal * (finite(input.overheadPct) / 100);
  const total = subtotal + overhead;

  return { depreciation, service, fixed, energy, gas, operator, tooling, subtotal, overhead, total, valid };
}

/** Coerce a loosely typed object (localStorage, form) into inputs; missing → 0. */
export function coerceMachineHourInputs(raw: unknown): MachineHourInputs {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = { ...EMPTY_MACHINE_HOUR_INPUTS };
  for (const field of MACHINE_HOUR_FIELDS) {
    const value = source[field];
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    result[field] = Number.isFinite(n) ? n : 0;
  }
  return result;
}
