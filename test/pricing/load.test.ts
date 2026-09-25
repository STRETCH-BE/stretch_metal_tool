/**
 * lib/rates/load.ts against a stub Supabase client — verifies every rate
 * table is queried by rate_version_id, the active version is resolved,
 * and errors become PricingErrors.
 * File path: /test/pricing/load.test.ts
 */

import { describe, expect, it } from "vitest";
import { PricingError } from "@/lib/pricing/errors";
import { loadActiveRateVersionId, loadMachinePark, loadRateSnapshot, type RatesClient } from "@/lib/rates/load";
import { MACHINE_PARK, RATE_SNAPSHOT_V1, RATE_VERSION_ID, machineParkToRows, rateSnapshotToRows } from "@/test/helpers/rates";

type Row = Record<string, unknown>;
type Call = { table: string; filters: [string, unknown][]; orders: string[]; single: boolean };

function stubClient(tables: Record<string, Row[]>, options: { failTable?: string } = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, filters: [], orders: [], single: false };
    calls.push(call);
    const run = () => {
      if (options.failTable === table) return { data: null, error: { message: "boom" } };
      let data = tables[table] ?? [];
      for (const [column, value] of call.filters) data = data.filter((row) => row[column] === value);
      return { data: call.single ? (data[0] ?? null) : data, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      },
      order: (column: string) => {
        call.orders.push(column);
        return builder;
      },
      maybeSingle: () => {
        call.single = true;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { client: { from } as unknown as RatesClient, calls };
}

function seededTables(): Record<string, Row[]> {
  const rows = rateSnapshotToRows(RATE_SNAPSHOT_V1);
  const other = rateSnapshotToRows({ ...RATE_SNAPSHOT_V1, versionId: "v-old", label: "old" });
  return {
    rate_versions: [
      { id: "v-old", label: "old", active: false },
      { id: RATE_VERSION_ID, label: RATE_SNAPSHOT_V1.label, active: true },
    ],
    rate_general: [other.general, rows.general],
    materials: [...other.materials, ...rows.materials],
    rate_laser: [...other.laser, ...rows.laser],
    rate_tube_laser: [...other.tubeLaser, ...rows.tubeLaser],
    rate_bend: [...other.bend, ...rows.bend],
    rate_roll: [...other.roll, ...rows.roll],
    rate_weld: [...other.weld, ...rows.weld],
    rate_thread: [...other.thread, ...rows.thread],
    rate_feature: [...other.feature, ...rows.feature],
    rate_finish: [...other.finish, ...rows.finish],
    machines: machineParkToRows(MACHINE_PARK),
  };
}

describe("loadActiveRateVersionId", () => {
  it("returns the active version id", async () => {
    const { client, calls } = stubClient(seededTables());
    await expect(loadActiveRateVersionId(client)).resolves.toBe(RATE_VERSION_ID);
    expect(calls[0]).toMatchObject({ table: "rate_versions", filters: [["active", true]], single: true });
  });

  it("throws no_active_rate_version when none is active", async () => {
    const tables = seededTables();
    tables.rate_versions = tables.rate_versions.map((v) => ({ ...v, active: false }));
    const { client } = stubClient(tables);
    await expect(loadActiveRateVersionId(client)).rejects.toMatchObject({ code: "no_active_rate_version" });
  });
});

describe("loadRateSnapshot", () => {
  it("loads the active version's rows only and builds the snapshot", async () => {
    const { client, calls } = stubClient(seededTables());
    const snapshot = await loadRateSnapshot(client);
    expect(snapshot.versionId).toBe(RATE_VERSION_ID);
    expect(snapshot.label).toBe(RATE_SNAPSHOT_V1.label);
    expect(snapshot.materials).toHaveLength(RATE_SNAPSHOT_V1.materials.length);
    expect(snapshot.laser).toHaveLength(RATE_SNAPSHOT_V1.laser.length);
    expect(snapshot.general).toEqual(RATE_SNAPSHOT_V1.general);
    const rateTables = calls.filter((c) => c.table !== "rate_versions");
    expect(rateTables.map((c) => c.table).sort()).toEqual(
      ["materials", "rate_bend", "rate_feature", "rate_finish", "rate_general", "rate_laser", "rate_roll", "rate_thread", "rate_tube_laser", "rate_weld"].sort()
    );
    for (const c of rateTables) {
      expect(c.filters).toContainEqual(["rate_version_id", RATE_VERSION_ID]);
    }
  });

  it("loads an explicit (old) version without touching the active flag", async () => {
    const { client, calls } = stubClient(seededTables());
    const snapshot = await loadRateSnapshot(client, "v-old");
    expect(snapshot.versionId).toBe("v-old");
    expect(snapshot.label).toBe("old");
    expect(calls.some((c) => c.filters.some(([column]) => column === "active"))).toBe(false);
  });

  it("throws rate_version_not_found for an unknown version and db_error on a failing table", async () => {
    const { client } = stubClient(seededTables());
    await expect(loadRateSnapshot(client, "ghost")).rejects.toMatchObject({ code: "rate_version_not_found" });
    const failing = stubClient(seededTables(), { failTable: "rate_bend" });
    await expect(loadRateSnapshot(failing.client)).rejects.toMatchObject({ code: "db_error", details: { table: "rate_bend" } });
    await expect(loadRateSnapshot(failing.client)).rejects.toBeInstanceOf(PricingError);
  });
});

describe("loadMachinePark", () => {
  it("loads and validates the machine rows", async () => {
    const { client } = stubClient(seededTables());
    const park = await loadMachinePark(client);
    expect(park.map((m) => m.code)).toEqual([...MACHINE_PARK].map((m) => m.code).sort());
    expect(park.find((m) => m.kind === "flat_laser")?.limits).toEqual(MACHINE_PARK[0].limits);
  });

  it("propagates invalid limits as a PricingError", async () => {
    const tables = seededTables();
    tables.machines = [{ ...tables.machines[0], limits: { nope: 1 } }];
    const { client } = stubClient(tables);
    await expect(loadMachinePark(client)).rejects.toMatchObject({ code: "invalid_machine_limits" });
  });
});
