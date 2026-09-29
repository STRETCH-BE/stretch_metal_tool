/**
 * Assembly-mode settings actions with the fake Supabase: the admin-only
 * guard (a sales session is refused before any client is created),
 * validation before the database (margins above 90, an unknown country,
 * a negative rate, an unknown setup code), `placeholder = false` on every
 * write, the audit row with before/after, the delete path (audit with
 * after = null, notFound for a vanished row), and the error mapping for a
 * missing table (migration not applied) and a duplicate natural key.
 * File path: /test/admin/settings-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, fakeClient } from "./fake-supabase";

const { createAdminClient, getCurrentUser, logAudit, revalidatePath } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) => Boolean(session && roles.includes(session.profile.role)),
  ADMIN_ONLY: ["admin"],
}));

import {
  deleteShippingRate,
  deleteVatRate,
  deleteWeldSpeed,
  saveAssemblyRates,
  saveCompanySettings,
  saveJobSetupRate,
  upsertPackagingRate,
  upsertShippingRate,
  upsertVatRate,
  upsertWeldSpeed,
} from "@/lib/admin/settings-actions";

const ADMIN = { user: { id: "admin-1" }, profile: { role: "admin" } };
const SALES = { user: { id: "sales-1" }, profile: { role: "sales" } };
const SHIPPING_ID = "5b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const SPEED_ID = "6b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";
const MISSING = { message: 'relation "public.vat_rates" does not exist', code: "42P01" };

const COMPANY_INPUT = {
  brand: "STRETCHMETAL",
  legal_name: "Alto Design Sp. z o.o.",
  street: "ul. Legionów 59",
  postal_code: "42-200",
  city: "Częstochowa",
  country: "pl",
  phone: "+32 485 48 30 35",
  email: "info@stretchmetal.pl",
  website: "https://stretchmetal.pl",
  nip: "PL5732911703",
  regon: "383390837",
  krs: "0000786996",
  bank_name: "ING Bank Śląski",
  iban_pln: "PL05 1050 1142 1000 0090 3188 9240",
  iban_eur: "PL05 1050 1142 1000 0090 3188 9240",
  swift: "INGBPLPW",
  oss_active: "on",
  assembly_margin_pct: "32,5",
  subcontract_margin_pct: 15,
};

describe("settings actions", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    revalidatePath.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  describe("guard and validation (no database call)", () => {
    it("refuses a sales session before creating any client", async () => {
      getCurrentUser.mockResolvedValue(SALES);
      const results = await Promise.all([
        saveCompanySettings(COMPANY_INPUT),
        upsertVatRate({ country: "PL", rate_pct: 23 }),
        deleteVatRate("PL"),
        upsertPackagingRate({ code: "carton", name: "Carton", max_side_mm: 400, max_mass_kg: 5, price_eur: 2.75 }),
        upsertShippingRate({ country: "PL", max_kg: 5, price_eur: 9 }),
        saveJobSetupRate({ code: "laser_nest", cost_eur: 17.5 }),
        saveAssemblyRates({
          labour_rate_eur_h: 25,
          gas_wire_eur_h: 8,
          tack_seconds: 60,
          fitup_min_per_part: 6,
          deburr_min_per_part: 1.5,
          handling_min_per_assembly: 10,
          distortion_factor: 1.3,
          step_bend_seconds_per_hit: 25,
          roll_min_per_m: 6,
        }),
        upsertWeldSpeed({ process: "mig_mag", thickness_mm: 2, speed_mm_min: 120 }),
      ]);
      for (const result of results) expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it("refuses a signed-out caller", async () => {
      getCurrentUser.mockResolvedValue(null);
      expect(await upsertVatRate({ country: "PL", rate_pct: 23 })).toEqual({ ok: false, error: "forbidden" });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("rejects a company margin above 90 % and names the field", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const result = await saveCompanySettings({ ...COMPANY_INPUT, assembly_margin_pct: 95 });
      expect(result).toEqual({ ok: false, error: "validation", field: "assembly_margin_pct" });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("rejects an unknown country code and a negative VAT rate", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      expect(await upsertVatRate({ country: "XX", rate_pct: 23 })).toEqual({ ok: false, error: "validation", field: "country" });
      expect(await upsertVatRate({ country: "PL", rate_pct: "-1" })).toEqual({ ok: false, error: "validation", field: "rate_pct" });
      expect(await upsertVatRate({ country: "PL", rate_pct: "abc" })).toEqual({ ok: false, error: "validation", field: "rate_pct" });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("rejects an unknown setup code and an unknown weld process", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      expect(await saveJobSetupRate({ code: "paint", cost_eur: 5 })).toEqual({ ok: false, error: "validation", field: "code" });
      expect(await upsertWeldSpeed({ process: "plasma", thickness_mm: 2, speed_mm_min: 100 })).toEqual({
        ok: false,
        error: "validation",
        field: "process",
      });
      expect(await upsertWeldSpeed({ process: "tig", thickness_mm: 0, speed_mm_min: 100 })).toEqual({
        ok: false,
        error: "validation",
        field: "thickness_mm",
      });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("rejects a malformed id on delete", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      expect(await deleteShippingRate("nope")).toEqual({ ok: false, error: "validation", field: "id" });
      expect(await deleteWeldSpeed("")).toEqual({ ok: false, error: "validation", field: "id" });
      expect(createAdminClient).not.toHaveBeenCalled();
    });
  });

  describe("company settings", () => {
    it("upserts row 1 with normalised values and audits settings.company with before/after", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const before = { id: 1, brand: "STRETCHMETAL", legal_name: "[CONFIRM]", country: "PL", oss_active: false, assembly_margin_pct: 30, subcontract_margin_pct: 15 };
      const after = { ...before, legal_name: "Alto Design Sp. z o.o.", oss_active: true, assembly_margin_pct: 32.5 };
      const client = fakeClient({ company_settings: { single: [{ data: before }, { data: after }] } });
      createAdminClient.mockReturnValue(client);

      const result = await saveCompanySettings(COMPANY_INPUT);
      expect(result).toEqual({ ok: true });

      const upsert = callsTo(client.calls, "company_settings", "upsert")[0];
      const row = upsert.args[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        id: 1,
        country: "PL",
        legal_name: "Alto Design Sp. z o.o.",
        oss_active: true,
        assembly_margin_pct: 32.5,
        subcontract_margin_pct: 15,
        updated_by: "admin-1",
      });
      expect(upsert.args[1]).toEqual({ onConflict: "id" });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ actor: "admin-1", action: "settings.company", entity: "company_settings", entityId: "1", before, after })
      );
      expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
      expect(revalidatePath).toHaveBeenCalledWith("/admin/settings/company");
      expect(revalidatePath).toHaveBeenCalledWith("/admin");
    });

    it("maps a missing table to missingTable without auditing", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      createAdminClient.mockReturnValue(fakeClient({ company_settings: { single: { data: null, error: MISSING } } }));
      expect(await saveCompanySettings(COMPANY_INPUT)).toEqual({ ok: false, error: "missingTable" });
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe("row tables", () => {
    it("upserts a VAT rate by country (upper-cased) and audits settings.vat", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const after = { country: "FI", rate_pct: 25.5, updated_by: "admin-1" };
      const client = fakeClient({ vat_rates: { single: [{ data: null }, { data: after }] } });
      createAdminClient.mockReturnValue(client);

      expect(await upsertVatRate({ country: "fi", rate_pct: "25,5" })).toEqual({ ok: true });
      const upsert = callsTo(client.calls, "vat_rates", "upsert")[0];
      expect(upsert.args[0]).toMatchObject({ country: "FI", rate_pct: 25.5, updated_by: "admin-1" });
      expect(upsert.args[1]).toEqual({ onConflict: "country" });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.vat", entity: "vat_rates", entityId: "FI", before: null, after }));
    });

    it("deletes a VAT rate with the row as `before` and after = null; notFound when it is gone", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const row = { country: "FI", rate_pct: 25.5 };
      const client = fakeClient({ vat_rates: { single: { data: row }, list: { data: null } } });
      createAdminClient.mockReturnValue(client);
      expect(await deleteVatRate("fi")).toEqual({ ok: true });
      expect(callsTo(client.calls, "vat_rates", "delete")).toHaveLength(1);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.vat", entityId: "FI", before: row, after: null }));

      createAdminClient.mockReturnValue(fakeClient({ vat_rates: { single: { data: null } } }));
      expect(await deleteVatRate("FI")).toEqual({ ok: false, error: "notFound" });
    });

    it("writes placeholder = false on a packaging upsert and audits settings.packaging", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const before = { code: "carton", name: "Carton", max_side_mm: 400, max_mass_kg: 5, price_eur: 2.75, position: 1, placeholder: true };
      const after = { ...before, price_eur: 3, placeholder: false };
      const client = fakeClient({ packaging_rates: { single: [{ data: before }, { data: after }] } });
      createAdminClient.mockReturnValue(client);

      expect(await upsertPackagingRate({ code: "Carton", name: "Carton", max_side_mm: "400", max_mass_kg: "5", price_eur: "3,00", position: "1" })).toEqual({ ok: true });
      const upsert = callsTo(client.calls, "packaging_rates", "upsert")[0];
      expect(upsert.args[0]).toMatchObject({ code: "carton", price_eur: 3, position: 1, placeholder: false, updated_by: "admin-1" });
      expect(upsert.args[1]).toEqual({ onConflict: "code" });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.packaging", entity: "packaging_rates", entityId: "carton", before, after }));
    });

    it("inserts a shipping band on the natural key, and maps a unique-key violation to duplicate", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const after = { id: SHIPPING_ID, country: "DE", max_kg: 5, price_eur: 15, carrier: "courier", position: 1, placeholder: false };
      const client = fakeClient({ shipping_rates: { single: [{ data: null }, { data: after }] } });
      createAdminClient.mockReturnValue(client);
      expect(await upsertShippingRate({ country: "de", max_kg: "5", price_eur: "15", carrier: "courier", position: "1" })).toEqual({ ok: true });
      const upsert = callsTo(client.calls, "shipping_rates", "upsert")[0];
      expect(upsert.args[0]).toMatchObject({ country: "DE", max_kg: 5, price_eur: 15, carrier: "courier", placeholder: false });
      expect(upsert.args[1]).toEqual({ onConflict: "country,max_kg" });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.shipping", entity: "shipping_rates", entityId: SHIPPING_ID, before: null, after }));

      createAdminClient.mockReturnValue(
        fakeClient({ shipping_rates: { single: [{ data: after }, { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }] } })
      );
      expect(await upsertShippingRate({ id: SHIPPING_ID, country: "DE", max_kg: 30, price_eur: 35 })).toEqual({ ok: false, error: "duplicate" });
    });

    it("updates a shipping band by id, or answers notFound when the id is gone", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const before = { id: SHIPPING_ID, country: "DE", max_kg: 5, price_eur: 15, carrier: "courier", position: 1, placeholder: true };
      const after = { ...before, price_eur: 16, placeholder: false };
      const client = fakeClient({ shipping_rates: { single: [{ data: before }, { data: after }] } });
      createAdminClient.mockReturnValue(client);
      expect(await upsertShippingRate({ id: SHIPPING_ID, country: "DE", max_kg: 5, price_eur: 16, carrier: "courier", position: 1 })).toEqual({ ok: true });
      const update = callsTo(client.calls, "shipping_rates", "update")[0];
      expect(update.args[0]).toMatchObject({ price_eur: 16, placeholder: false });
      expect(callsTo(client.calls, "shipping_rates", "upsert")).toHaveLength(0);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.shipping", before, after }));

      createAdminClient.mockReturnValue(fakeClient({ shipping_rates: { single: { data: null } } }));
      expect(await upsertShippingRate({ id: SHIPPING_ID, country: "DE", max_kg: 5, price_eur: 16 })).toEqual({ ok: false, error: "notFound" });
    });

    it("saves a job setup cost keeping the seeded name, clears placeholder and audits settings.setup", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const before = { code: "laser_nest", name: "Laser nest set-up (per material / thickness)", cost_eur: 17.5, placeholder: true };
      const after = { ...before, cost_eur: 18, placeholder: false };
      const client = fakeClient({ job_setup_rates: { single: [{ data: before }, { data: after }] } });
      createAdminClient.mockReturnValue(client);
      expect(await saveJobSetupRate({ code: "laser_nest", cost_eur: "18" })).toEqual({ ok: true });
      const upsert = callsTo(client.calls, "job_setup_rates", "upsert")[0];
      expect(upsert.args[0]).toMatchObject({ code: "laser_nest", name: before.name, cost_eur: 18, placeholder: false });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.setup", entity: "job_setup_rates", entityId: "laser_nest", before, after }));
    });

    it("saves the assembly rates row 1 with placeholder = false and audits settings.assembly", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const before = { id: 1, labour_rate_eur_h: 25, distortion_factor: 1.3, placeholder: true };
      const after = { ...before, labour_rate_eur_h: 27, placeholder: false };
      const client = fakeClient({ assembly_rates: { single: [{ data: before }, { data: after }] } });
      createAdminClient.mockReturnValue(client);
      const result = await saveAssemblyRates({
        labour_rate_eur_h: "27",
        gas_wire_eur_h: "8",
        tack_seconds: "60",
        fitup_min_per_part: "6",
        deburr_min_per_part: "1,5",
        handling_min_per_assembly: "10",
        distortion_factor: "1.3",
        step_bend_seconds_per_hit: "25",
        roll_min_per_m: "6",
      });
      expect(result).toEqual({ ok: true });
      const upsert = callsTo(client.calls, "assembly_rates", "upsert")[0];
      expect(upsert.args[0]).toMatchObject({ id: 1, labour_rate_eur_h: 27, deburr_min_per_part: 1.5, distortion_factor: 1.3, placeholder: false });
      expect(upsert.args[1]).toEqual({ onConflict: "id" });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.assembly", entity: "assembly_rates", entityId: "1", before, after }));
    });

    it("refuses a distortion factor below 1", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const result = await saveAssemblyRates({
        labour_rate_eur_h: 25,
        gas_wire_eur_h: 8,
        tack_seconds: 60,
        fitup_min_per_part: 6,
        deburr_min_per_part: 1.5,
        handling_min_per_assembly: 10,
        distortion_factor: 0.8,
        step_bend_seconds_per_hit: 25,
        roll_min_per_m: 6,
      });
      expect(result).toEqual({ ok: false, error: "validation", field: "distortion_factor" });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("upserts a weld speed on process + thickness, deletes by id, audits settings.weld_speed", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      const after = { id: SPEED_ID, process: "mig_mag", thickness_mm: 2, speed_mm_min: 125, placeholder: false };
      const client = fakeClient({ weld_speeds: { single: [{ data: null }, { data: after }] } });
      createAdminClient.mockReturnValue(client);
      expect(await upsertWeldSpeed({ process: "mig_mag", thickness_mm: "2", speed_mm_min: "125" })).toEqual({ ok: true });
      const upsert = callsTo(client.calls, "weld_speeds", "upsert")[0];
      expect(upsert.args[0]).toMatchObject({ process: "mig_mag", thickness_mm: 2, speed_mm_min: 125, placeholder: false });
      expect(upsert.args[1]).toEqual({ onConflict: "process,thickness_mm" });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.weld_speed", entity: "weld_speeds", entityId: SPEED_ID, before: null, after }));

      const deleting = fakeClient({ weld_speeds: { single: { data: after }, list: { data: null } } });
      createAdminClient.mockReturnValue(deleting);
      expect(await deleteWeldSpeed(SPEED_ID)).toEqual({ ok: true });
      expect(callsTo(deleting.calls, "weld_speeds", "delete")).toHaveLength(1);
      expect(logAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "settings.weld_speed", entityId: SPEED_ID, before: after, after: null }));
    });

    it("reports a database error with its message", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      createAdminClient.mockReturnValue(fakeClient({ vat_rates: { single: [{ data: null }, { data: null, error: { message: "boom" } }] } }));
      expect(await upsertVatRate({ country: "PL", rate_pct: 23 })).toEqual({ ok: false, error: "db", message: "boom" });
      expect(logAudit).not.toHaveBeenCalled();
    });

    it("answers db when the service-role client cannot be created", async () => {
      getCurrentUser.mockResolvedValue(ADMIN);
      createAdminClient.mockImplementation(() => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
      });
      expect(await upsertVatRate({ country: "PL", rate_pct: 23 })).toEqual({ ok: false, error: "db", message: "SUPABASE_SERVICE_ROLE_KEY is not set" });
    });
  });
});
