/**
 * lib/parts/queries.ts loadRatesInfo — the part page's rate facts never
 * throw: a failing rate load returns empty materials with the REAL reason
 * (RatesInfo.error), and a failing machine park keeps the material list
 * (only the flat-laser hint is lost).
 * File path: /test/parts/rates-info.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PricingError } from "@/lib/pricing/errors";
import type { ServerSupabase } from "@/lib/supabase/server";
import { MACHINE_PARK, RATE_SNAPSHOT_V1 } from "@/test/helpers/rates";

vi.mock("@/lib/rates/load", () => ({
  loadRateSnapshot: vi.fn(),
  loadMachinePark: vi.fn(),
}));
vi.mock("./../../lib/parts/access", () => ({ requirePartReader: vi.fn() }));

import { loadMachinePark, loadRateSnapshot } from "@/lib/rates/load";
import { loadRatesInfo } from "@/lib/parts/queries";

const supabase = {} as ServerSupabase;
const snapshot = vi.mocked(loadRateSnapshot);
const park = vi.mocked(loadMachinePark);

describe("loadRatesInfo", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    snapshot.mockReset();
    park.mockReset();
  });

  it("returns the materials, choices and the flat-laser hint when everything loads", async () => {
    snapshot.mockResolvedValue(RATE_SNAPSHOT_V1);
    park.mockResolvedValue(MACHINE_PARK);
    const info = await loadRatesInfo(supabase, null);
    expect(info.error).toBeNull();
    expect(info.versionId).toBe(RATE_SNAPSHOT_V1.versionId);
    expect(info.materials.map((m) => m.code)).toEqual(RATE_SNAPSHOT_V1.materials.map((m) => m.code));
    expect(info.flatLaser?.name).toBe(MACHINE_PARK.find((m) => m.kind === "flat_laser")?.name);
  });

  it("keeps the material list when only the machine park fails (hint absent, logged)", async () => {
    snapshot.mockResolvedValue(RATE_SNAPSHOT_V1);
    park.mockRejectedValue(new PricingError("db_error", "press_brake_tools: Could not find the table", { table: "press_brake_tools" }));
    const info = await loadRatesInfo(supabase, null);
    expect(info.error).toBeNull();
    expect(info.materials.length).toBe(RATE_SNAPSHOT_V1.materials.length);
    expect(info.flatLaser).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("names the real reason when the rates fail: no active version, a missing pinned version, or the loader's error text", async () => {
    park.mockResolvedValue(MACHINE_PARK);
    snapshot.mockRejectedValueOnce(new PricingError("no_active_rate_version", "no active rate version"));
    expect((await loadRatesInfo(supabase, null)).error).toEqual({ code: "no_active_rate_version", message: "no active rate version" });
    snapshot.mockRejectedValueOnce(new PricingError("rate_version_not_found", "rate version x does not exist", { versionId: "x" }));
    expect((await loadRatesInfo(supabase, "x")).error?.code).toBe("rate_version_not_found");
    snapshot.mockRejectedValueOnce(new PricingError("db_error", "materials: permission denied", { table: "materials" }));
    const failed = await loadRatesInfo(supabase, null);
    expect(failed.error).toEqual({ code: "unavailable", message: "materials: permission denied" });
    expect(failed.materials).toEqual([]);
    expect(failed.choices).toEqual([]);
    snapshot.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await loadRatesInfo(supabase, null)).error).toEqual({ code: "unavailable", message: "fetch failed" });
  });
});
