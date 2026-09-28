/**
 * Parallel storage of split models (lib/parts/intake.ts storeModelParts):
 * a synthetic IFC with ~50 distinct elements plus repeats is stored with
 * bounded concurrency — split order, contiguous item positions, the old
 * uniqueName names, occurrence quantities, ONE re-price — the concurrency
 * limit holds against fake deps, a failing part leaves the others stored
 * (status partial, failure reported), and a resume after 41 of 45 parts
 * stores exactly the missing 4 without duplicates.
 * File path: /test/intake/intake-parallel.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { analyseStepSync, analyzeDxfSync, applyAnnotationsSync, geometryToSvg, splitModelSync } from "@/lib/geometry";
import { buildIfc, type IfcElementSpec } from "../geometry/ifc-builder";
import { tessellatedPlate } from "../geometry/mesh-fixtures";
import { evaluateBrep } from "@/lib/geometry/step/brep";
import { parseStep } from "@/lib/geometry/step/part21";
import { polygonsOfFacetedBody } from "@/lib/geometry/step/mesh";
import type { SplitModel } from "@/lib/geometry/types";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import { sha256 } from "@/lib/files/storage";
import {
  MODEL_PART_CONCURRENCY,
  processUploadedFile,
  resumeIntake,
  runPool,
  THUMBNAIL_SIZE,
  type IntakeDb,
  type IntakeDeps,
  type IntakeFile,
  type IntakeProgress,
  type PartInsert,
  type StoredSourcePart,
} from "@/lib/parts/intake";

const QUOTE = "11111111-1111-4111-8111-111111111111";
const DISTINCT = 45;
/** Elements 0..4 appear twice (mapped representation shared) → qty 2. */
const REPEATED = 5;

type PartRecord = PartInsert & { id: string };
type ItemRecord = { id: string; quoteId: string; partId: string; position: number; qty: number };
type FileRecord = IntakeFile & Partial<IntakeProgress>;

const plate = polygonsOfFacetedBody(evaluateBrep(parseStep(tessellatedPlate())).bodies[0]).map((poly) =>
  poly.map((p) => ({ x: p.x / 1000, y: p.y / 1000, z: p.z / 1000 }))
);

function hallIfc(): { bytes: Uint8Array; expectedNames: string[] } {
  const elements: IfcElementSpec[] = [];
  const names: string[] = [];
  for (let i = 0; i < DISTINCT; i++) {
    const name = `Plate ${String(i + 1).padStart(2, "0")}`;
    names.push(name);
    elements.push({ kind: "brep", name, polygons: plate, mapShared: `map-${i}` });
    if (i < REPEATED) elements.push({ kind: "brep", name, polygons: plate, mapShared: `map-${i}` });
  }
  return { bytes: new Uint8Array(Buffer.from(buildIfc(elements))), expectedNames: names };
}

/** Sequential reference of the old naming rule (base, base (2), …). */
function oldUniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const base = name.trim() || "part";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

type Store = ReturnType<typeof memoryStore>;

function memoryStore(options: { opDelayMs?: number; failPartNames?: string[] } = {}) {
  const parts: PartRecord[] = [];
  const items: ItemRecord[] = [];
  const files: FileRecord[] = [];
  const updates: ({ fileId: string } & Partial<IntakeProgress>)[] = [];
  let seq = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const delay = async () => {
    if (!options.opDelayMs) return;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, options.opDelayMs));
    inFlight -= 1;
  };
  const db: IntakeDb = {
    async findAnnotationsByHash() {
      return null;
    },
    async findPartByBaseName() {
      return null;
    },
    async findPdfByBaseName() {
      return null;
    },
    async insertPart(row) {
      await delay();
      if (options.failPartNames?.includes(row.name)) throw new Error(`boom ${row.name}`);
      const id = `part-${++seq}`;
      parts.push({ ...row, id });
      return { id };
    },
    async updatePart() {
      throw new Error("not used");
    },
    async nextItemPosition(quoteId) {
      await delay();
      return items.filter((i) => i.quoteId === quoteId).reduce((max, i) => Math.max(max, i.position), 0) + 1;
    },
    async insertItem(row) {
      await delay();
      const id = `item-${++seq}`;
      items.push({ id, ...row });
      return { id };
    },
    async updateFileIntake(fileId, patch) {
      const file = files.find((f) => f.id === fileId);
      if (!file) throw new Error("no file");
      Object.assign(file, patch);
      updates.push({ fileId, ...patch });
    },
    async findPartsBySourceFile(sourceFileId): Promise<StoredSourcePart[]> {
      return parts
        .filter((p) => p.sourceFileId === sourceFileId)
        .map((p) => {
          const item = items.find((i) => i.partId === p.id);
          return { id: p.id, itemId: item?.id ?? null, name: p.name, qty: item?.qty ?? 1, triage: p.triage, thicknessMm: p.thicknessMm ?? null, thumbnailSvg: p.thumbnailSvg };
        });
    },
  };
  const addFile = (name: string, bytes: Uint8Array): IntakeFile => {
    const id = `file-${++seq}`;
    const record: FileRecord = { id, originalName: name, storagePath: `quotes/${QUOTE}/${id}/${name}`, sha256: sha256(bytes) };
    files.push(record);
    return { ...record };
  };
  const reprice = vi.fn(async () => undefined);
  const deps: IntakeDeps = {
    analyse: async (text, o) => analyzeDxfSync(text, o),
    analyseStep: async (text, o) => analyseStepSync(text, o),
    splitModel: async (text, o) => splitModelSync(text, o),
    saveDerivedFile: async ({ name, bytes }) => {
      await delay();
      return addFile(name, bytes);
    },
    applyAnnotations: async (g, a, o) => applyAnnotationsSync(g, a, o),
    toSvg: (g, a) => geometryToSvg(g, a, { ...THUMBNAIL_SIZE, theme: "light" }),
    extractPdfText: async () => "",
    prefill: async () => null,
    heuristics: heuristicSuggestions,
    download: async () => new Uint8Array(),
    densityFor: () => 7850,
    db,
    reprice,
    blankMarginMm: 10,
    locale: "pl",
  };
  return { parts, items, files, updates, addFile, deps, reprice, maxInFlight: () => maxInFlight };
}

async function upload(store: Store, bytes: Uint8Array, name = "hall.ifc") {
  const file = store.addFile(name, bytes);
  const result = await processUploadedFile({ quoteId: QUOTE, file, buffer: bytes, kind: "ifc", actor: "u", deps: store.deps });
  if (result.kind !== "assembly") throw new Error("expected assembly");
  return { file, result };
}

describe("storeModelParts — parallel", () => {
  const { bytes, expectedNames } = hallIfc();

  it("stores 45 parts in split order with contiguous positions, old names, occurrence quantities and one re-price", async () => {
    const store = memoryStore();
    // Two items already in the quote: positions must continue after them.
    store.items.push({ id: "i-a", quoteId: QUOTE, partId: "p-a", position: 1, qty: 1 }, { id: "i-b", quoteId: QUOTE, partId: "p-b", position: 2, qty: 1 });
    const split: SplitModel = await store.deps.splitModel(Buffer.from(bytes).toString("latin1"), { toleranceMm: 0.01, blankMarginMm: 10, name: "hall" });
    expect(split.parts).toHaveLength(DISTINCT);

    const started = performance.now();
    const { file, result } = await upload(store, bytes);
    const elapsedMs = performance.now() - started;
    console.info(`[timing] 45-part IFC intake (in-memory deps): ${elapsedMs.toFixed(0)} ms`);

    expect(result.intakeStatus).toBe("done");
    expect(result.expected).toBe(DISTINCT);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toBe(0);
    // Order and names = split order + the sequential uniqueName rule.
    expect(result.parts.map((p) => p.name)).toEqual(oldUniqueNames(split.parts.map((p) => p.name)));
    expect(result.parts.map((p) => p.name)).toEqual(expectedNames);
    // Contiguous positions start..start+n-1 in split order.
    const positions = result.parts.map((p) => store.items.find((i) => i.id === p.itemId)!.position);
    expect(positions).toEqual(result.parts.map((_, i) => 3 + i));
    // Quantities = occurrences.
    expect(result.parts.slice(0, REPEATED).map((p) => p.qty)).toEqual(new Array(REPEATED).fill(2));
    expect(result.parts.slice(REPEATED).every((p) => p.qty === 1)).toBe(true);
    expect(store.reprice).toHaveBeenCalledTimes(1);
    // Every part links to the upload; each has its own derived STEP file.
    expect(store.parts.every((p) => p.sourceFileId === file.id)).toBe(true);
    expect(store.files).toHaveLength(1 + DISTINCT);
    // Tracking on the upload row.
    const row = store.files.find((f) => f.id === file.id)!;
    expect(row).toMatchObject({ intakeStatus: "done", partsExpected: DISTINCT, partsDone: DISTINCT, intakeError: null });
    expect(store.updates[0]).toMatchObject({ intakeStatus: "processing", partsExpected: DISTINCT, partsDone: 0 });
  });

  it("keeps at most MODEL_PART_CONCURRENCY parts in flight and is well faster than sequential", async () => {
    const opDelayMs = 8;
    const store = memoryStore({ opDelayMs });
    const started = performance.now();
    const { result } = await upload(store, bytes);
    const elapsedMs = performance.now() - started;
    expect(result.parts).toHaveLength(DISTINCT);
    expect(store.maxInFlight()).toBeGreaterThan(1);
    expect(store.maxInFlight()).toBeLessThanOrEqual(MODEL_PART_CONCURRENCY);
    // Sequential: 3 delayed ops per part (+ 1 position read) ≈ 45 × 3 × 8 ms.
    const sequentialMs = (DISTINCT * 3 + 1) * opDelayMs;
    console.info(`[timing] fake deps ${opDelayMs} ms/op: parallel ${elapsedMs.toFixed(0)} ms vs sequential ≈ ${sequentialMs} ms`);
    expect(elapsedMs).toBeLessThan(sequentialMs);
  });

  it("stores the other parts when one fails, ends partial and reports the failure", async () => {
    const store = memoryStore({ failPartNames: ["Plate 07"] });
    const { file, result } = await upload(store, bytes);
    expect(result.intakeStatus).toBe("partial");
    expect(result.parts).toHaveLength(DISTINCT - 1);
    expect(result.parts.some((p) => p.name === "Plate 07")).toBe(false);
    expect(result.failed).toEqual([{ name: "Plate 07", error: "boom Plate 07" }]);
    expect(store.reprice).toHaveBeenCalledTimes(1);
    const row = store.files.find((f) => f.id === file.id)!;
    expect(row).toMatchObject({ intakeStatus: "partial", partsExpected: DISTINCT, partsDone: DISTINCT - 1 });
    expect(row.intakeError).toContain("Plate 07");
    // Positions are fixed up front (start + index): the failed part leaves its slot free.
    const positions = store.items.map((i) => i.position).sort((a, b) => a - b);
    const all = Array.from({ length: DISTINCT }, (_, i) => 1 + i);
    expect(positions).toEqual(all.filter((n) => n !== 7));
  });

  it("resumes with 41 of 45 parts already stored: exactly 4 created, no duplicates, status done", async () => {
    const store = memoryStore();
    const { file } = await upload(store, bytes);
    // Simulate the run killed after 41 parts (and no re-price).
    const missing = ["Plate 11", "Plate 22", "Plate 33", "Plate 44"];
    for (const name of missing) {
      const part = store.parts.find((p) => p.name === name)!;
      store.parts.splice(store.parts.indexOf(part), 1);
      const item = store.items.find((i) => i.partId === part.id)!;
      store.items.splice(store.items.indexOf(item), 1);
    }
    Object.assign(store.files.find((f) => f.id === file.id)!, { intakeStatus: "processing", partsDone: DISTINCT - 4 });
    store.reprice.mockClear();
    const partCountBefore = store.parts.length;
    const positionBefore = Math.max(...store.items.map((i) => i.position));

    const result = await resumeIntake({ quoteId: QUOTE, file, buffer: bytes, kind: "ifc", actor: "u", deps: store.deps });
    if (result.kind !== "assembly") throw new Error("expected assembly");
    expect(result.intakeStatus).toBe("done");
    expect(result.skipped).toBe(DISTINCT - 4);
    expect(result.parts).toHaveLength(DISTINCT);
    expect(result.parts.map((p) => p.name)).toEqual(hallIfc().expectedNames);
    expect(store.parts).toHaveLength(partCountBefore + 4);
    expect(new Set(store.parts.map((p) => p.name)).size).toBe(DISTINCT);
    // The 4 new items continue after the last position, in split order.
    const fresh = missing.map((name) => store.items.find((i) => i.partId === store.parts.find((p) => p.name === name)!.id)!.position);
    expect(fresh).toEqual([positionBefore + 1, positionBefore + 2, positionBefore + 3, positionBefore + 4]);
    expect(store.reprice).toHaveBeenCalledTimes(1);
    expect(store.files.find((f) => f.id === file.id)).toMatchObject({ intakeStatus: "done", partsExpected: DISTINCT, partsDone: DISTINCT });
  });

  it("resume with everything stored creates nothing and still re-prices", async () => {
    const store = memoryStore();
    const { file } = await upload(store, bytes);
    store.reprice.mockClear();
    const result = await resumeIntake({ quoteId: QUOTE, file, buffer: bytes, kind: "ifc", actor: "u", deps: store.deps });
    if (result.kind !== "assembly") throw new Error("expected assembly");
    expect(result.skipped).toBe(DISTINCT);
    expect(store.parts).toHaveLength(DISTINCT);
    expect(store.reprice).toHaveBeenCalledTimes(1);
  });
});

describe("runPool", () => {
  it("runs at most `limit` workers and visits every item in order of start", async () => {
    let inFlight = 0;
    let max = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      seen.push(item);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
    });
    expect(max).toBe(3);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
