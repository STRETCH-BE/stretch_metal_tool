/**
 * rowsToJobRates: DB rows (numbers as strings) → JobRates; empty tables fall
 * back to the seeded defaults and mark the rates as placeholder; weld speed
 * lookup takes the smallest thickness ≥ t of the process, else its largest.
 * File path: /lib/pricing/job-rates.test.ts
 */
import { describe, expect, it } from "vitest";
import { JOB_RATE_DEFAULTS, rowsToJobRates, weldSpeedFor } from "./job-rates";

describe("rowsToJobRates", () => {
  it("falls back to the seeded defaults (placeholder) when every table is empty", () => {
    const rates = rowsToJobRates({ company: null, vat: [], packaging: [], shipping: [], setups: [], assembly: null, weldSpeeds: [] });
    expect(rates).toEqual(JOB_RATE_DEFAULTS);
    expect(rates.placeholder).toBe(true);
  });

  it("maps rows with string numerics and reports placeholder only when a used row says so", () => {
    const rates = rowsToJobRates({
      company: { id: "1", oss_active: "true", assembly_margin_pct: "32.5", subcontract_margin_pct: "12", country: "pl" } as never,
      vat: [{ country: "pl", rate_pct: "23" }, { country: "DE", rate_pct: "19" }] as never,
      packaging: [{ code: "box", name: "Box", max_side_mm: "500", max_mass_kg: "10", price_eur: "3.5", position: "1", placeholder: false }] as never,
      shipping: [{ country: "de", max_kg: "30", price_eur: "35", carrier: "courier", placeholder: false }] as never,
      setups: ["laser_nest", "press_brake", "roll", "weld_fitup"].map((code) => ({ code, cost_eur: "10", placeholder: false })) as never,
      assembly: { labour_rate_eur_h: "30", gas_wire_eur_h: "8", tack_seconds: "60", fitup_min_per_part: "5", deburr_min_per_part: "1", handling_min_per_assembly: "10", distortion_factor: "1.2", step_bend_seconds_per_hit: "25", roll_min_per_m: "6", placeholder: false } as never,
      weldSpeeds: [{ process: "mig_mag", thickness_mm: "2", speed_mm_min: "120", placeholder: false }] as never,
    });
    expect(rates.ossActive).toBe(true);
    expect(rates.assemblyMarginPct).toBe(32.5);
    expect(rates.homeCountry).toBe("PL");
    expect(rates.vatRates).toEqual({ PL: 23, DE: 19 });
    expect(rates.packaging[0]).toMatchObject({ code: "box", maxSideMm: 500, priceEur: 3.5 });
    expect(rates.shipping[0]).toMatchObject({ countryCode: "DE", maxKg: 30, priceEur: 35 });
    expect(rates.setups).toEqual({ laser_nest: 10, press_brake: 10, roll: 10, weld_fitup: 10 });
    expect(rates.assembly.labourRateEurH).toBe(30);
    expect(rates.weldSpeeds).toEqual([{ process: "mig_mag", thicknessMm: 2, speedMmMin: 120 }]);
    expect(rates.placeholder).toBe(false);
  });

  it("weldSpeedFor picks the smallest thickness at or above t, else the largest, null for an unknown process", () => {
    expect(weldSpeedFor(JOB_RATE_DEFAULTS, "mig_mag", 2)).toBe(120);
    expect(weldSpeedFor(JOB_RATE_DEFAULTS, "mig_mag", 2.5)).toBe(100);
    expect(weldSpeedFor(JOB_RATE_DEFAULTS, "mig_mag", 8)).toBe(60);
    expect(weldSpeedFor(JOB_RATE_DEFAULTS, "tig", 1)).toBe(60);
    expect(weldSpeedFor({ weldSpeeds: [] }, "mig_mag", 2)).toBeNull();
  });
});
