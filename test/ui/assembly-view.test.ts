/**
 * Assembly editor view helpers (components/quote/assembly-view.ts):
 * members vs loose items, order quantity, inherited material and the
 * "differs" marker, the DC01-for-S235 note rule, forming flag ↔
 * operation matching and the admin cost-panel grouping.
 * File path: /test/ui/assembly-view.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  flagMatchesOperation,
  formingSummary,
  groupAssemblyCosts,
  looseItems,
  materialNoteRequired,
  memberItemIds,
  memberItems,
  memberView,
  notFeasibleFlag,
  orderQty,
} from "@/components/quote/assembly-view";
import { OPERATION_LABELS } from "@/lib/pricing/labels";
import type { Flag, FormingOperation, OperationLine } from "@/lib/pricing/types";
import { ASSEMBLY_ID, ITEM_ID, ITEM_ID_2, makeAssemblyRow, makeItemRow, makePartRow, PART_ID_2 } from "@/test/quotes/fixtures";

const assembly = makeAssemblyRow({ qty: 3, material_code: "S235", thickness_mm: 3 });
const member = makeItemRow({ id: ITEM_ID, assembly_id: ASSEMBLY_ID, qty_per_assembly: 2, position: 1 });
const loose = makeItemRow({ id: ITEM_ID_2, part_id: PART_ID_2, assembly_id: null, position: 0 });
const orphan = makeItemRow({ id: "orphan", assembly_id: "00000000-0000-4000-8000-00000000dead", position: 2 });

describe("members and loose items", () => {
  it("splits the items by assembly membership; an orphaned assembly_id counts as loose", () => {
    expect(memberItems([loose, member, orphan], ASSEMBLY_ID).map((i) => i.id)).toEqual([ITEM_ID]);
    expect(looseItems([loose, member, orphan], [assembly]).map((i) => i.id)).toEqual([ITEM_ID_2, "orphan"]);
    expect([...memberItemIds([loose, member, orphan], [assembly])]).toEqual([ITEM_ID]);
  });

  it("order qty = assembly qty × pieces per assembly", () => {
    expect(orderQty(assembly, member)).toBe(6);
    expect(orderQty({ qty: "2" as unknown as number }, { qty_per_assembly: "5" as unknown as number })).toBe(10);
  });
});

describe("memberView", () => {
  it("inherits the assembly material when the part has none and marks a differing grade", () => {
    const inherited = memberView(member, makePartRow({ material_code: null, thickness_mm: null }), assembly);
    expect(inherited).toMatchObject({ materialCode: "S235", thicknessMm: 3, differs: false, qtyPerAssembly: 2, orderQty: 6 });
    const differs = memberView(member, makePartRow({ material_code: "DC01", thickness_mm: 3 }), assembly);
    expect(differs).toMatchObject({ materialCode: "DC01", differs: true });
    const thinner = memberView(member, makePartRow({ material_code: "s235", thickness_mm: 2 }), assembly);
    expect(thinner.differs).toBe(true);
    const same = memberView(member, makePartRow({ material_code: "s235jr", thickness_mm: 3 }), makeAssemblyRow({ material_code: "S235JR", thickness_mm: 3 }));
    expect(same.differs).toBe(false);
  });

  it("parses the stored forming JSON", () => {
    const op: FormingOperation = { id: "f1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: null };
    expect(memberView(makeItemRow({ forming: [op] }), makePartRow(), assembly).forming).toEqual([op]);
  });
});

describe("materialNoteRequired", () => {
  it("is required only when DC01 replaces a requested S235", () => {
    expect(materialNoteRequired("S235", "DC01")).toBe(true);
    expect(materialNoteRequired("S235JR", "dc01")).toBe(true);
    expect(materialNoteRequired("S235", "S355")).toBe(false);
    expect(materialNoteRequired("DC01", "S235")).toBe(false);
    expect(materialNoteRequired(null, "DC01")).toBe(false);
  });
});

describe("forming flags", () => {
  const roll: FormingOperation = { id: "f1", kind: "roll", insideRadiusMm: 90, angleDeg: 180, widthMm: 247, resolution: null };
  const flag: Flag = {
    code: "forming.not_feasible",
    severity: "red",
    partId: null,
    itemId: ITEM_ID,
    params: { operation: "roll", kind: "roll", radiusMm: 90, angleDeg: 180, widthMm: 247, reason: "min_radius", value: 90, limit: 200 },
    overridable: false,
  };

  it("matches a flag to the operation by kind and geometry", () => {
    expect(flagMatchesOperation(flag, roll)).toBe(true);
    expect(flagMatchesOperation(flag, { ...roll, widthMm: 300 })).toBe(false);
    expect(flagMatchesOperation({ ...flag, code: "assembly.no_seams" }, roll)).toBe(false);
    expect(notFeasibleFlag([flag], roll)).toBe(flag);
    expect(notFeasibleFlag([{ ...flag, code: "forming.step_bend" }], roll)).toBeNull();
  });

  it("summarises an operation for its chip", () => {
    const fmt = (n: number) => String(n);
    expect(formingSummary(roll, fmt)).toBe("R90 × 180° × 247");
    expect(formingSummary({ id: "b", kind: "bend", bends: 2, angleDeg: 90, lengthMm: 375, resolution: null }, fmt)).toBe("2 × 90° × 375");
  });
});

describe("groupAssemblyCosts", () => {
  function line(label: string, type: OperationLine["type"], unitCost: number, minutes?: number): OperationLine {
    return { id: label, type, label, driverQty: 1, driverUnit: "lot", rateRef: { table: "manual", key: label, values: {} }, unitCost, setupShare: 0, auto: true, notes: null, details: minutes === undefined ? {} : { minutes } };
  }

  it("groups parts at cost, labour by kind with minutes, setups and subcontracting", () => {
    const groups = groupAssemblyCosts({
      operations: [
        line(OPERATION_LABELS.assemblyParts, "material", 25.9),
        line(OPERATION_LABELS.assemblyFitup, "weld", 68.25, 163.8),
        line(OPERATION_LABELS.assemblyWeld, "weld", 16.97, 40.73),
        line(OPERATION_LABELS.assemblyGasWire, "weld", 5.64, 42.33),
        line(OPERATION_LABELS.stepBend, "bend", 3.3, 7.92),
        line(OPERATION_LABELS.setupLaserNest, "setup", 17.5),
        line(OPERATION_LABELS.setupWeldFitup, "setup", 12.5),
        line(OPERATION_LABELS.subcontractForming, "roll", 46),
      ],
    });
    expect(groups.partsEur).toBeCloseTo(25.9);
    expect(groups.labour.map((r) => r.kind)).toEqual(["fitup", "weld", "gasWire", "forming"]);
    expect(groups.labour.find((r) => r.kind === "forming")).toMatchObject({ minutes: 7.92, eur: 3.3 });
    expect(groups.labourEur).toBeCloseTo(68.25 + 16.97 + 5.64 + 3.3);
    expect(groups.setups).toHaveLength(2);
    expect(groups.setupsEur).toBeCloseTo(30);
    expect(groups.subcontractEur).toBeCloseTo(46);
    expect(groups.other).toEqual([]);
  });
});
