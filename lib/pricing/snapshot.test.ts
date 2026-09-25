/**
 * Snapshot conversion — DB rows (numbers or strings) → RateSnapshot /
 * MachinePark, zod validation of the JSON columns and machine limits.
 * File path: /lib/pricing/snapshot.test.ts
 */

import { describe, expect, it } from "vitest";
import type { MachineRow } from "@/lib/db/types";
import {
  MACHINE_PARK,
  RATE_SNAPSHOT_V1,
  machineParkToRows,
  rateSnapshotToRows,
} from "@/test/helpers/rates";
import { PricingError } from "./errors";
import {
  flatLaserLimitsSchema,
  machineLimitsSchemas,
  num,
  pressBrakeLimitsSchema,
  rollLimitsSchema,
  rowsToMachinePark,
  rowsToRateSnapshot,
  tubeLaserLimitsSchema,
  weldLimitsSchema,
  type RateRows,
} from "./snapshot";

function stringify(rows: RateRows): RateRows {
  // simulate PostgREST numerics arriving as strings on every numeric column
  const asStrings = <T extends object>(row: T): T =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, typeof v === "number" ? String(v) : v])
    ) as T;
  return {
    version: rows.version,
    general: asStrings(rows.general),
    materials: rows.materials.map(asStrings),
    laser: rows.laser.map(asStrings),
    tubeLaser: rows.tubeLaser.map(asStrings),
    bend: rows.bend.map(asStrings),
    roll: rows.roll.map(asStrings),
    weld: rows.weld.map(asStrings),
    thread: rows.thread.map(asStrings),
    feature: rows.feature.map(asStrings),
    finish: rows.finish.map(asStrings),
  };
}

describe("rowsToRateSnapshot", () => {
  const rows = rateSnapshotToRows(RATE_SNAPSHOT_V1);

  it("round-trips the fixture snapshot losslessly (sorted output)", () => {
    const snapshot = rowsToRateSnapshot(rows);
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const sorted = {
      ...RATE_SNAPSHOT_V1,
      materials: [...RATE_SNAPSHOT_V1.materials].sort((a, b) => cmp(a.code, b.code)),
      laser: [...RATE_SNAPSHOT_V1.laser].sort(
        (a, b) =>
          cmp(a.materialCode, b.materialCode) ||
          a.thicknessMm - b.thicknessMm ||
          Number(b.inHouse) - Number(a.inHouse)
      ),
      tubeLaser: [...RATE_SNAPSHOT_V1.tubeLaser].sort(
        (a, b) => cmp(a.profileFamily, b.profileFamily) || a.wallMm - b.wallMm
      ),
      weld: [...RATE_SNAPSHOT_V1.weld].sort((a, b) => cmp(a.process, b.process) || a.beadMm - b.beadMm),
      thread: [...RATE_SNAPSHOT_V1.thread].sort((a, b) => cmp(a.size, b.size)),
      feature: [...RATE_SNAPSHOT_V1.feature].sort((a, b) => cmp(a.code, b.code)),
      finish: [...RATE_SNAPSHOT_V1.finish].sort((a, b) => cmp(a.code, b.code)),
    };
    expect(snapshot).toEqual(sorted);
  });

  it("coerces string numerics from PostgREST into numbers", () => {
    const snapshot = rowsToRateSnapshot(stringify(rows));
    expect(snapshot.general.machineRateEurH).toBe(70);
    expect(snapshot.general.defaultStitch).toEqual({ beadLengthMm: 30, pitchMm: 60 });
    const s355 = snapshot.laser.find((r) => r.materialCode === "S355" && r.thicknessMm === 12);
    expect(s355?.speedMMin).toBe(1.7);
    expect(s355?.pierceS).toBe(2);
    expect(s355?.pricePerM).toBeNull();
    expect(snapshot.weld.find((r) => r.process === "mig_mag")?.pricePerMm).toBe(0.045);
    expect(snapshot.materials.find((m) => m.code === "S355")?.rmNmm2).toBe(510);
    expect(rowsToRateSnapshot(stringify(rows))).toEqual(rowsToRateSnapshot(rows));
  });

  it("parses and sorts the JSON columns (price bands, sheet formats, margin by class)", () => {
    const rowsWithJson: RateRows = {
      ...rows,
      general: { ...rows.general, margin_by_class: { key_account: "22.5", oem: 18 } },
      materials: [
        {
          ...rows.materials[0],
          code: "X",
          price_per_kg: [
            { maxThicknessMm: "12", pricePerKg: "1.6" },
            { maxThicknessMm: 3, pricePerKg: 2 },
          ],
          sheet_formats: [{ lengthMm: "2000", widthMm: 1000 }],
        },
      ],
      laser: [],
    };
    const snapshot = rowsToRateSnapshot(rowsWithJson);
    expect(snapshot.general.marginByClass).toEqual({ key_account: 22.5, oem: 18 });
    expect(snapshot.materials[0].pricePerKg).toEqual([
      { maxThicknessMm: 3, pricePerKg: 2 },
      { maxThicknessMm: 12, pricePerKg: 1.6 },
    ]);
    expect(snapshot.materials[0].sheetFormats).toEqual([{ lengthMm: 2000, widthMm: 1000 }]);
  });

  it("maps the gas column onto the typed union", () => {
    const snapshot = rowsToRateSnapshot({
      ...rows,
      laser: [
        { ...rows.laser[0], gas: "o2" },
        { ...rows.laser[0], thickness_mm: 2, gas: "AIR" },
        { ...rows.laser[0], thickness_mm: 3, gas: "argon" },
        { ...rows.laser[0], thickness_mm: 4, gas: null },
      ],
    });
    expect(snapshot.laser.map((r) => r.gas)).toEqual(["O2", "air", null, null]);
  });

  it("rejects malformed JSON columns and bad numerics with a typed error naming the field", () => {
    const codeOf = (fn: () => unknown): { code: string; message: string } => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(PricingError);
        return { code: (e as PricingError).code, message: (e as PricingError).message };
      }
      return { code: "none", message: "" };
    };
    const badBands = codeOf(() =>
      rowsToRateSnapshot({ ...rows, materials: [{ ...rows.materials[0], price_per_kg: "oops" }] })
    );
    expect(badBands.code).toBe("invalid_rate_json");
    expect(badBands.message).toContain("price_per_kg");

    const badBand = codeOf(() =>
      rowsToRateSnapshot({
        ...rows,
        materials: [{ ...rows.materials[0], price_per_kg: [{ maxThicknessMm: 3, pricePerKg: "abc" }] }],
      })
    );
    expect(badBand.code).toBe("invalid_rate_json");
    expect(badBand.message).toContain("pricePerKg");

    const badFamily = codeOf(() =>
      rowsToRateSnapshot({ ...rows, materials: [{ ...rows.materials[0], family: "wood" as never }] })
    );
    expect(badFamily.message).toContain("family");

    const badNumber = codeOf(() =>
      rowsToRateSnapshot({ ...rows, bend: [{ ...rows.bend[0], price_per_bend: "n/a" }] })
    );
    expect(badNumber.code).toBe("invalid_rate_json");
    expect(badNumber.message).toContain("price_per_bend");

    const emptyString = codeOf(() =>
      rowsToRateSnapshot({ ...rows, general: { ...rows.general, blank_margin_mm: "" } })
    );
    expect(emptyString.message).toContain("blank_margin_mm");

    const badEnum = codeOf(() =>
      rowsToRateSnapshot({ ...rows, weld: [{ ...rows.weld[0], process: "glue" as never }] })
    );
    expect(badEnum.message).toContain("process");
  });

  it("num(): numbers, numeric strings, and nothing else", () => {
    expect(num(1.5, "x")).toBe(1.5);
    expect(num("1.5", "x")).toBe(1.5);
    expect(num(" 12 ", "x")).toBe(12);
    expect(() => num("", "x")).toThrow(PricingError);
    expect(() => num(null, "x")).toThrow(PricingError);
    expect(() => num("1e999", "x")).toThrow(PricingError);
    expect(() => num(Number.NaN, "x")).toThrow(PricingError);
  });
});

describe("rowsToMachinePark", () => {
  const machineRows = machineParkToRows(MACHINE_PARK);

  it("round-trips the fixture park (sorted by code) and the schemas accept its limits", () => {
    const park = rowsToMachinePark(machineRows);
    const sorted = [...MACHINE_PARK].sort((a, b) => (a.code < b.code ? -1 : 1));
    expect(park).toEqual(sorted);
    for (const m of MACHINE_PARK) {
      expect(machineLimitsSchemas[m.kind].safeParse(m.limits).success).toBe(true);
    }
    expect(flatLaserLimitsSchema.parse(MACHINE_PARK[0].limits)).toEqual(MACHINE_PARK[0].limits);
    expect(tubeLaserLimitsSchema.parse(MACHINE_PARK[1].limits)).toEqual(MACHINE_PARK[1].limits);
    expect(pressBrakeLimitsSchema.parse(MACHINE_PARK[2].limits)).toEqual(MACHINE_PARK[2].limits);
    expect(rollLimitsSchema.parse(MACHINE_PARK[3].limits)).toEqual(MACHINE_PARK[3].limits);
    expect(weldLimitsSchema.parse(MACHINE_PARK[4].limits)).toEqual(MACHINE_PARK[4].limits);
  });

  it("strips unknown keys", () => {
    const row: MachineRow = {
      ...machineRows[3],
      limits: { maxWidthMm: 3200, minRadiusMm: 200, maxThicknessMm: 6, colour: "red" },
    };
    const [roll] = rowsToMachinePark([row]);
    expect(roll.limits).toEqual({ maxWidthMm: 3200, minRadiusMm: 200, maxThicknessMm: 6 });
  });

  it("invalid limits JSON throws with a message naming the machine code", () => {
    const failing: MachineRow[] = [
      { ...machineRows[0], code: "laser-x", limits: { bedLengthMm: 3000 } },
      { ...machineRows[0], code: "laser-str", limits: { ...(machineRows[0].limits as object), bedWidthMm: "1500" } },
      { ...machineRows[1], code: "tube-x", limits: { ...(machineRows[1].limits as object), wallThicknessMm: { mild_steel: [14] } } },
      { ...machineRows[2], code: "brake-x", limits: { ...(machineRows[2].limits as object), forceKN: -1 } },
      { ...machineRows[4], code: "weld-x", limits: { processes: ["mig_mag", "glue"] } },
      { ...machineRows[4], code: "weld-null", limits: null },
      { ...machineRows[4], code: "kind-x", kind: "plasma" as never },
    ];
    for (const row of failing) {
      let caught: unknown = null;
      try {
        rowsToMachinePark([row]);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PricingError);
      expect((caught as PricingError).code).toBe("invalid_machine_limits");
      expect((caught as PricingError).message).toContain(row.code);
      expect((caught as PricingError).details.machine).toBe(row.code);
    }
  });
});
