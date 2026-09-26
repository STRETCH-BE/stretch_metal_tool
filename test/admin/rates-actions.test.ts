/**
 * Rate-row server actions with mocked Supabase — role refusal for a
 * sales session, validation before any DB call, the draft rule (active /
 * used versions are read-only), update path with audit before/after, the
 * activate guard (the RPC deactivates everything before it updates by id,
 * so an unknown id must never reach it) and the materials delete guard
 * (rate_laser cascades on delete: refuse without cascade, audit each row).
 * File path: /test/admin/rates-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, fakeClient } from "./fake-supabase";

const { createClient, redirect, getCurrentUser, logAudit, revalidatePath } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) =>
    Boolean(session && roles.includes(session.profile.role)),
  ADMIN_ONLY: ["admin"],
}));

import {
  activateRateVersionAction,
  cloneRateVersionAction,
  deleteRateRow,
  importRateCsv,
  saveRateRow,
} from "@/lib/admin/rates-actions";
import { INITIAL_CSV_IMPORT_STATE } from "@/lib/admin/rates-types";

const VERSION = "4b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const ROW_ID = "5b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const ADMIN = { user: { id: "admin-1" }, profile: { role: "admin" } };
const SALES = { user: { id: "sales-1" }, profile: { role: "sales" } };

const draftVersion = { id: VERSION, label: "v2", note: null, created_by: null, created_at: "2026-09-25", active: false };
const LASER_VALUES = {
  material_code: "S235",
  thickness_mm: 3,
  in_house: true,
  mode: "time",
  speed_m_min: 11,
  pierce_s: 0.4,
  price_per_m: null,
  price_per_pierce: 0,
  gas: "O2",
  min_contour_mm: 30,
  supplier: null,
};

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("saveRateRow", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    revalidatePath.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a sales session before any database call", async () => {
    getCurrentUser.mockResolvedValue(SALES);
    const result = await saveRateRow({ versionId: VERSION, table: "laser", ref: { id: ROW_ID }, values: LASER_VALUES });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("validates before touching the database and returns codes per column", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const result = await saveRateRow({
      versionId: VERSION,
      table: "laser",
      ref: {},
      values: { ...LASER_VALUES, thickness_mm: "x", mode: "warp" },
    });
    expect(result).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { thickness_mm: "invalidNumber", mode: "invalidOption" },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses to edit the active version", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(fakeClient({ rate_versions: { single: { data: { ...draftVersion, active: true } } } }));
    const result = await saveRateRow({ versionId: VERSION, table: "laser", ref: { id: ROW_ID }, values: LASER_VALUES });
    expect(result).toEqual({ ok: false, error: "versionActive" });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses to edit a version referenced by quotes", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(
      fakeClient({
        rate_versions: { single: { data: draftVersion } },
        quotes: { list: { data: [{ rate_version_id: VERSION }] } },
      })
    );
    const result = await saveRateRow({ versionId: VERSION, table: "laser", ref: { id: ROW_ID }, values: LASER_VALUES });
    expect(result).toEqual({ ok: false, error: "versionHasQuotes" });
  });

  it("updates a draft row with placeholder=false and audits rate_laser.update with before/after", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const before = { id: ROW_ID, rate_version_id: VERSION, ...LASER_VALUES, speed_m_min: 10, placeholder: true };
    const after = { id: ROW_ID, rate_version_id: VERSION, ...LASER_VALUES, placeholder: false };
    const client = fakeClient({
      rate_versions: { single: { data: draftVersion } },
      quotes: { list: { data: [] } },
      rate_laser: { single: [{ data: before }, { data: after }] },
    });
    createClient.mockResolvedValue(client);
    const result = await saveRateRow({ versionId: VERSION, table: "laser", ref: { id: ROW_ID }, values: LASER_VALUES });
    expect(result).toEqual({ ok: true, row: after });
    const update = callsTo(client.calls, "rate_laser", "update")[0].args[0];
    expect(update).toEqual({ ...LASER_VALUES, placeholder: false });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rate_laser.update", entity: "rate_laser", entityId: ROW_ID, before, after })
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/rates/${VERSION}`);
  });

  it("inserts a new row into the draft version and audits rate_bend.insert", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const inserted = { id: ROW_ID, rate_version_id: VERSION, thickness_mm: 2, length_class_mm: 1000, price_per_bend: 1.5, setup_per_part_type: 10, placeholder: false };
    const client = fakeClient({
      rate_versions: { single: { data: draftVersion } },
      quotes: { list: { data: [] } },
      rate_bend: { single: { data: inserted } },
    });
    createClient.mockResolvedValue(client);
    const result = await saveRateRow({
      versionId: VERSION,
      table: "bend",
      ref: {},
      values: { thickness_mm: "2", length_class_mm: "1000", price_per_bend: "1,5", setup_per_part_type: 10 },
    });
    expect(result).toEqual({ ok: true, row: inserted });
    expect(callsTo(client.calls, "rate_bend", "insert")[0].args[0]).toEqual({
      thickness_mm: 2,
      length_class_mm: 1000,
      price_per_bend: 1.5,
      setup_per_part_type: 10,
      rate_version_id: VERSION,
      placeholder: false,
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "rate_bend.insert", after: inserted }));
  });

  it("maps a unique violation to duplicateKey", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(
      fakeClient({
        rate_versions: { single: { data: draftVersion } },
        quotes: { list: { data: [] } },
        rate_thread: { single: { data: null, error: { message: "duplicate key value", code: "23505" } } },
      })
    );
    const result = await saveRateRow({ versionId: VERSION, table: "thread", ref: {}, values: { size: "M8", price_each: 1 } });
    expect(result).toMatchObject({ ok: false, error: "duplicateKey" });
  });
});

describe("deleteRateRow / cloneRateVersionAction / importRateCsv", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    redirect.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("deleteRateRow refuses a sales session and never deletes the general row", async () => {
    getCurrentUser.mockResolvedValue(SALES);
    expect(await deleteRateRow({ versionId: VERSION, table: "laser", ref: { id: ROW_ID } })).toEqual({ ok: false, error: "forbidden" });
    getCurrentUser.mockResolvedValue(ADMIN);
    expect(await deleteRateRow({ versionId: VERSION, table: "general", ref: {} })).toEqual({ ok: false, error: "invalid" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("cloneRateVersionAction redirects a sales session to /forbidden", async () => {
    getCurrentUser.mockResolvedValue(SALES);
    await expect(cloneRateVersionAction(form({ source: VERSION, label: "v3" }))).rejects.toThrow("NEXT_REDIRECT:/forbidden");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("cloneRateVersionAction clones, audits and opens the new version", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const newId = "6b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
    createClient.mockResolvedValue(fakeClient({}, { clone_rate_version: { data: newId } }));
    await expect(cloneRateVersionAction(form({ source: VERSION, label: "v3" }))).rejects.toThrow(
      `NEXT_REDIRECT:/admin/rates/${newId}?notice=cloned`
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rate_version.clone", entityId: newId, after: { id: newId, label: "v3" } })
    );
  });

  it("importRateCsv upserts by natural key and reports per-line errors", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const existing = { id: ROW_ID, rate_version_id: VERSION, size: "M8", price_each: 1, placeholder: true };
    const client = fakeClient({
      rate_versions: { single: { data: draftVersion } },
      quotes: { list: { data: [] } },
      rate_thread: {
        // loadRateTableRows → existing; then update (M8) → ok; insert (M10) → ok
        list: [{ data: [existing] }, { data: null, error: null }, { data: null, error: null }],
      },
    });
    createClient.mockResolvedValue(client);
    const csv = "size,price_each,placeholder\r\nM8,1.25,true\r\nM10,abc,\r\nM12,2,\r\n";
    const data = new FormData();
    data.set("file", new File([csv], "threads.csv", { type: "text/csv" }));
    const state = await importRateCsv(VERSION, "thread", INITIAL_CSV_IMPORT_STATE, data);
    expect(state.status).toBe("done");
    expect(state.imported).toBe(2);
    expect(state.errors).toEqual([{ line: 3, column: "price_each", code: "invalidNumber" }]);
    const update = callsTo(client.calls, "rate_thread", "update")[0].args[0];
    expect(update).toEqual({ size: "M8", price_each: 1.25, placeholder: false });
    const insert = callsTo(client.calls, "rate_thread", "insert")[0].args[0];
    expect(insert).toEqual({ size: "M12", price_each: 2, placeholder: false, rate_version_id: VERSION });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "rate_thread.import" }));
  });

  it("deleteRateRow refuses to delete a material that still has laser rows (FK cascade) and reports the count", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const material = { rate_version_id: VERSION, code: "S235", name: "Steel", family: "mild_steel", placeholder: false };
    const laserRows = [
      { id: ROW_ID, rate_version_id: VERSION, material_code: "S235", thickness_mm: 3, in_house: true },
      { id: "7b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c", rate_version_id: VERSION, material_code: "S235", thickness_mm: 15, in_house: false },
    ];
    const client = fakeClient({
      rate_versions: { single: { data: draftVersion } },
      quotes: { list: { data: [] } },
      materials: { single: { data: material } },
      rate_laser: { list: { data: laserRows } },
    });
    createClient.mockResolvedValue(client);
    const result = await deleteRateRow({ versionId: VERSION, table: "materials", ref: { key: "S235" } });
    expect(result).toEqual({ ok: false, error: "materialInUse", count: 2 });
    expect(callsTo(client.calls, "materials", "delete")).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
    // the dependants were looked up for THIS version and material
    const filters = callsTo(client.calls, "rate_laser", "eq").map((call) => call.args);
    expect(filters).toEqual([["rate_version_id", VERSION], ["material_code", "S235"]]);
  });

  it("deleteRateRow with cascade deletes the material and audits every laser row that went with it", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const material = { rate_version_id: VERSION, code: "S235", name: "Steel", family: "mild_steel", placeholder: false };
    const laserRow = { id: ROW_ID, rate_version_id: VERSION, material_code: "S235", thickness_mm: 3, in_house: true };
    const client = fakeClient({
      rate_versions: { single: { data: draftVersion } },
      quotes: { list: { data: [] } },
      materials: { single: { data: material }, list: { data: null, error: null } },
      rate_laser: { list: { data: [laserRow] } },
    });
    createClient.mockResolvedValue(client);
    const result = await deleteRateRow({ versionId: VERSION, table: "materials", ref: { key: "S235" }, cascade: true });
    expect(result).toEqual({ ok: true, cascaded: 1 });
    expect(callsTo(client.calls, "materials", "delete")).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "rate_laser.delete",
        entity: "rate_laser",
        entityId: ROW_ID,
        before: laserRow,
        after: { cascadedFrom: `${VERSION}:S235` },
      })
    );
    expect(logAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "rate_materials.delete",
        entity: "materials",
        entityId: `${VERSION}:S235`,
        before: material,
        after: { cascadedLaserRows: 1 },
      })
    );
  });

  it("deleteRateRow deletes a material without laser rows plainly (no cascade needed)", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const material = { rate_version_id: VERSION, code: "X1", name: "Odd", family: "brass", placeholder: false };
    const client = fakeClient({
      rate_versions: { single: { data: draftVersion } },
      quotes: { list: { data: [] } },
      materials: { single: { data: material }, list: { data: null, error: null } },
      rate_laser: { list: { data: [] } },
    });
    createClient.mockResolvedValue(client);
    expect(await deleteRateRow({ versionId: VERSION, table: "materials", ref: { key: "X1" } })).toEqual({ ok: true });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "rate_materials.delete", after: null }));
  });

  it("importRateCsv reports missing header columns", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(
      fakeClient({ rate_versions: { single: { data: draftVersion } }, quotes: { list: { data: [] } } })
    );
    const data = new FormData();
    data.set("file", new File(["size\nM8\n"], "t.csv", { type: "text/csv" }));
    const state = await importRateCsv(VERSION, "thread", INITIAL_CSV_IMPORT_STATE, data);
    expect(state).toEqual({ status: "error", error: "missingColumns", missing: ["price_each"] });
  });
});

describe("activateRateVersionAction", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    redirect.mockClear();
    revalidatePath.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("never calls activate_rate_version for an id that is not a current version (the RPC would leave no active version)", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const client = fakeClient({ rate_versions: { single: { data: null } } }, { activate_rate_version: { data: null } });
    createClient.mockResolvedValue(client);
    await expect(activateRateVersionAction(VERSION)).rejects.toThrow("NEXT_REDIRECT:/admin/rates?error=activateMissing");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before any database call", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    await expect(activateRateVersionAction("not-a-uuid")).rejects.toThrow("NEXT_REDIRECT:/admin/rates?error=activateMissing");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("is a no-op for the version that is already active", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const client = fakeClient({ rate_versions: { single: { data: { ...draftVersion, active: true } } } }, { activate_rate_version: { data: null } });
    createClient.mockResolvedValue(client);
    await expect(activateRateVersionAction(VERSION)).rejects.toThrow("NEXT_REDIRECT:/admin/rates?notice=activated");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("activates an existing draft through the RPC and audits the previous active version", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    const previous = { id: "8b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c", label: "v1" };
    const client = fakeClient(
      { rate_versions: { single: [{ data: draftVersion }, { data: previous }] } },
      { activate_rate_version: { data: null } }
    );
    createClient.mockResolvedValue(client);
    await expect(activateRateVersionAction(VERSION)).rejects.toThrow("NEXT_REDIRECT:/admin/rates?notice=activated");
    expect(client.rpc).toHaveBeenCalledWith("activate_rate_version", { p_version: VERSION });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rate_version.activate",
        entityId: VERSION,
        before: { activeId: previous.id, label: "v1" },
        after: { activeId: VERSION },
      })
    );
  });

  it("redirects a sales session to /forbidden", async () => {
    getCurrentUser.mockResolvedValue(SALES);
    await expect(activateRateVersionAction(VERSION)).rejects.toThrow("NEXT_REDIRECT:/forbidden");
    expect(createClient).not.toHaveBeenCalled();
  });
});
