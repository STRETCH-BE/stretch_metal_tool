"use server";

/**
 * Assembly-mode settings server actions — company data, VAT rates,
 * packaging, shipping bands, job setups, assembly labour rates and weld
 * speeds. Admin only, zod-validated, every write audit-logged with the
 * row before and after.
 * File path: /lib/admin/settings-actions.ts
 *
 * Inputs are plain objects (numbers may arrive as the user typed them,
 * "1,5" or "1.5" — parsed with lib/number-input) so the client forms and
 * tests call the same functions. The role is checked first (a non-admin
 * gets `forbidden` without touching the database); the writes then use
 * the service-role client (the CLAUDE.md rule: createAdminClient only
 * after the role check) and set `updated_by` explicitly. Every save sets
 * `placeholder = false` on the row it writes — saving IS the admin's
 * confirmation of a calibration placeholder. Audit action names are the
 * design's seven: settings.company · settings.vat · settings.packaging ·
 * settings.shipping · settings.setup · settings.assembly ·
 * settings.weld_speed (a delete logs the same name with after = null).
 * Row saves upsert on the natural key (vat: country; packaging: code;
 * shipping: country + max_kg; weld speeds: process + thickness), or
 * update by id when the form passes one, so "add or correct" is one form.
 * A table that does not exist yet (migration not applied) → missingTable.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ONLY, getCurrentUser, hasRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import type { JobSetupCodeDb, Json, WeldProcessDb } from "@/lib/db/types";
import { parseNumberInput } from "@/lib/number-input";
import { isCountryCode, normalizeCountryCode } from "@/lib/customers/countries";
import { isMissingTableError } from "@/lib/admin/settings";
import {
  ASSEMBLY_RATE_FIELDS,
  JOB_SETUP_CODES,
  SETTINGS_MARGIN_MAX_PCT,
  SETTINGS_TABLE_SLUGS,
  WELD_SPEED_PROCESSES,
  type AssemblyRatesInput,
  type CompanySettingsInput,
  type JobSetupRateInput,
  type PackagingRateInput,
  type SettingsActionResult,
  type ShippingRateInput,
  type VatRateInput,
  type WeldSpeedInput,
} from "@/lib/admin/settings-types";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type Client = ReturnType<typeof createAdminClient>;
type DbError = { message: string; code?: string } | null;

async function adminSession(): Promise<Session | null> {
  const session = await getCurrentUser();
  return session && hasRole(session, ADMIN_ONLY) ? session : null;
}

const FORBIDDEN: SettingsActionResult = { ok: false, error: "forbidden" };

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

function dbFailure(error: NonNullable<DbError>): SettingsActionResult {
  if (isMissingTableError(error)) return { ok: false, error: "missingTable" };
  if (error.code === "23505" || /duplicate key/i.test(error.message)) return { ok: false, error: "duplicate" };
  return { ok: false, error: "db", message: error.message };
}

function validationFailure(error: z.ZodError): SettingsActionResult {
  const path = error.issues[0]?.path.map(String).join(".");
  return { ok: false, error: "validation", field: path || undefined };
}

/** The service-role client, or a `db` failure when the environment lacks the key. */
function client(): { supabase: Client; failure: null } | { supabase: null; failure: SettingsActionResult } {
  try {
    return { supabase: createAdminClient(), failure: null };
  } catch (error) {
    return { supabase: null, failure: { ok: false, error: "db", message: error instanceof Error ? error.message : String(error) } };
  }
}

function revalidateSettings(...tables: (keyof typeof SETTINGS_TABLE_SLUGS)[]): void {
  revalidatePath(routes.adminSettings);
  revalidatePath(routes.admin);
  for (const table of tables) revalidatePath(routes.adminSettingsTable(SETTINGS_TABLE_SLUGS[table]));
}

/* ─── Field schemas ──────────────────────────────────────── */

function toNumber(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseNumberInput(value);
    return parsed === null ? (value.trim() === "" ? undefined : value) : parsed;
  }
  return value ?? undefined;
}

function numberField(options: { min?: number; max?: number; gt?: number } = {}) {
  let base = z.number().finite();
  if (options.min !== undefined) base = base.min(options.min);
  if (options.max !== undefined) base = base.max(options.max);
  if (options.gt !== undefined) base = base.gt(options.gt);
  return z.preprocess(toNumber, base);
}

function optionalNumberField(fallback: number, options: { min?: number } = {}) {
  return z.preprocess((v) => (v === "" || v === null || v === undefined ? fallback : toNumber(v)), z.number().finite().min(options.min ?? 0));
}

function textField(max: number, options: { required?: boolean } = {}) {
  const base = z.string().trim().max(max);
  return z.preprocess((v) => (v === null || v === undefined ? "" : v), options.required ? base.min(1) : base);
}

function nullableTextField(max: number) {
  return z.preprocess(
    (v) => (v === null || v === undefined ? "" : v),
    z.string().trim().max(max).transform((v) => (v === "" ? null : v))
  );
}

const countryField = z.preprocess(
  (v) => normalizeCountryCode(typeof v === "string" ? v : ""),
  z.string().refine((code) => isCountryCode(code), "invalidCountry")
);

const boolField = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "on", "yes", "tak"].includes(v.trim().toLowerCase());
  return Boolean(v);
}, z.boolean());

const uuidField = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.uuid().optional());

const marginField = numberField({ min: 0, max: SETTINGS_MARGIN_MAX_PCT });

/* ─── Company settings ───────────────────────────────────── */

const companySchema = z.object({
  brand: textField(80, { required: true }),
  legal_name: textField(200, { required: true }),
  street: textField(200),
  postal_code: textField(20),
  city: textField(120),
  country: countryField,
  phone: textField(60),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.union([z.literal(""), z.email()])),
  website: textField(200),
  nip: textField(40),
  regon: textField(40),
  krs: textField(40),
  bank_name: textField(120),
  iban_pln: textField(60),
  iban_eur: textField(60),
  swift: textField(20),
  oss_active: boolField,
  assembly_margin_pct: marginField,
  subcontract_margin_pct: marginField,
});

export async function saveCompanySettings(input: CompanySettingsInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("company_settings").select("*").eq("id", 1).maybeSingle();
  if (before.error) return dbFailure(before.error);
  const result = await supabase
    .from("company_settings")
    .upsert({ id: 1, ...parsed.data, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("*")
    .single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.company",
    entity: "company_settings",
    entityId: "1",
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("company");
  return { ok: true };
}

/* ─── VAT rates ──────────────────────────────────────────── */

const vatSchema = z.object({
  country: countryField,
  rate_pct: numberField({ min: 0, max: 99.99 }),
});

export async function upsertVatRate(input: VatRateInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const parsed = vatSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("vat_rates").select("*").eq("country", parsed.data.country).maybeSingle();
  if (before.error) return dbFailure(before.error);
  const result = await supabase
    .from("vat_rates")
    .upsert({ ...parsed.data, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: "country" })
    .select("*")
    .single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.vat",
    entity: "vat_rates",
    entityId: parsed.data.country,
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("vat");
  return { ok: true };
}

export async function deleteVatRate(country: string): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const code = normalizeCountryCode(country);
  if (!isCountryCode(code)) return { ok: false, error: "validation", field: "country" };
  const { supabase, failure } = client();
  if (failure) return failure;

  // The home country's row is the fallback of every taxed VAT mode (lib/pricing/vat.ts): never deletable.
  const company = await supabase.from("company_settings").select("country").eq("id", 1).maybeSingle();
  if (company.error) return dbFailure(company.error);
  const home = normalizeCountryCode((company.data as { country?: string | null } | null)?.country ?? "PL");
  if (code === home) return { ok: false, error: "validation", field: "country", message: "home" };

  const before = await supabase.from("vat_rates").select("*").eq("country", code).maybeSingle();
  if (before.error) return dbFailure(before.error);
  if (!before.data) return { ok: false, error: "notFound" };
  const { error } = await supabase.from("vat_rates").delete().eq("country", code);
  if (error) return dbFailure(error);

  await logAudit({ actor: session.user.id, action: "settings.vat", entity: "vat_rates", entityId: code, before: asJson(before.data), after: null });
  revalidateSettings("vat");
  return { ok: true };
}

/* ─── Packaging rates ────────────────────────────────────── */

const packagingSchema = z.object({
  code: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, "invalidCode")
  ),
  name: textField(120, { required: true }),
  max_side_mm: numberField({ gt: 0 }),
  max_mass_kg: numberField({ gt: 0 }),
  price_eur: numberField({ min: 0 }),
  position: optionalNumberField(0),
});

export async function upsertPackagingRate(input: PackagingRateInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const parsed = packagingSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("packaging_rates").select("*").eq("code", parsed.data.code).maybeSingle();
  if (before.error) return dbFailure(before.error);
  const result = await supabase
    .from("packaging_rates")
    .upsert({ ...parsed.data, placeholder: false, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: "code" })
    .select("*")
    .single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.packaging",
    entity: "packaging_rates",
    entityId: parsed.data.code,
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("packaging");
  return { ok: true };
}

export async function deletePackagingRate(code: string): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const key = code.trim().toLowerCase();
  if (!key) return { ok: false, error: "validation", field: "code" };
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("packaging_rates").select("*").eq("code", key).maybeSingle();
  if (before.error) return dbFailure(before.error);
  if (!before.data) return { ok: false, error: "notFound" };
  const { error } = await supabase.from("packaging_rates").delete().eq("code", key);
  if (error) return dbFailure(error);

  await logAudit({ actor: session.user.id, action: "settings.packaging", entity: "packaging_rates", entityId: key, before: asJson(before.data), after: null });
  revalidateSettings("packaging");
  return { ok: true };
}

/* ─── Shipping rates ─────────────────────────────────────── */

const shippingSchema = z.object({
  id: uuidField,
  country: countryField,
  max_kg: numberField({ gt: 0 }),
  price_eur: numberField({ min: 0 }),
  carrier: nullableTextField(80),
  position: optionalNumberField(0),
});

export async function upsertShippingRate(input: ShippingRateInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const parsed = shippingSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const { id, ...values } = parsed.data;
  const row = { ...values, placeholder: false, updated_by: session.user.id, updated_at: new Date().toISOString() };
  const before = id
    ? await supabase.from("shipping_rates").select("*").eq("id", id).maybeSingle()
    : await supabase.from("shipping_rates").select("*").eq("country", values.country).eq("max_kg", values.max_kg).maybeSingle();
  if (before.error) return dbFailure(before.error);
  if (id && !before.data) return { ok: false, error: "notFound" };
  const result = id
    ? await supabase.from("shipping_rates").update(row).eq("id", id).select("*").single()
    : await supabase.from("shipping_rates").upsert(row, { onConflict: "country,max_kg" }).select("*").single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.shipping",
    entity: "shipping_rates",
    entityId: String(result.data.id),
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("shipping");
  return { ok: true };
}

export async function deleteShippingRate(id: string): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "validation", field: "id" };
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("shipping_rates").select("*").eq("id", id).maybeSingle();
  if (before.error) return dbFailure(before.error);
  if (!before.data) return { ok: false, error: "notFound" };
  const { error } = await supabase.from("shipping_rates").delete().eq("id", id);
  if (error) return dbFailure(error);

  await logAudit({ actor: session.user.id, action: "settings.shipping", entity: "shipping_rates", entityId: id, before: asJson(before.data), after: null });
  revalidateSettings("shipping");
  return { ok: true };
}

/* ─── Job setup rates ────────────────────────────────────── */

const setupSchema = z.object({
  code: z.enum(JOB_SETUP_CODES as [JobSetupCodeDb, ...JobSetupCodeDb[]]),
  cost_eur: numberField({ min: 0 }),
  name: z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined), z.string().max(160).optional()),
});

export async function saveJobSetupRate(input: JobSetupRateInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("job_setup_rates").select("*").eq("code", parsed.data.code).maybeSingle();
  if (before.error) return dbFailure(before.error);
  // A row the migration seeded keeps its name unless the form sends one; a brand-new row is named by its code.
  const name = parsed.data.name ?? (before.data ? String(before.data.name) : parsed.data.code);
  const result = await supabase
    .from("job_setup_rates")
    .upsert(
      { code: parsed.data.code, name, cost_eur: parsed.data.cost_eur, placeholder: false, updated_by: session.user.id, updated_at: new Date().toISOString() },
      { onConflict: "code" }
    )
    .select("*")
    .single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.setup",
    entity: "job_setup_rates",
    entityId: parsed.data.code,
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("setups");
  return { ok: true };
}

/* ─── Assembly rates (single row) ────────────────────────── */

const assemblySchema = z.object({
  labour_rate_eur_h: numberField({ min: 0 }),
  gas_wire_eur_h: numberField({ min: 0 }),
  tack_seconds: numberField({ min: 0 }),
  fitup_min_per_part: numberField({ min: 0 }),
  deburr_min_per_part: numberField({ min: 0 }),
  handling_min_per_assembly: numberField({ min: 0 }),
  distortion_factor: numberField({ min: 1 }),
  step_bend_seconds_per_hit: numberField({ min: 0 }),
  roll_min_per_m: numberField({ min: 0 }),
});

export async function saveAssemblyRates(input: AssemblyRatesInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const picked: Record<string, unknown> = {};
  for (const field of ASSEMBLY_RATE_FIELDS) picked[field] = input[field];
  const parsed = assemblySchema.safeParse(picked);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("assembly_rates").select("*").eq("id", 1).maybeSingle();
  if (before.error) return dbFailure(before.error);
  const result = await supabase
    .from("assembly_rates")
    .upsert({ id: 1, ...parsed.data, placeholder: false, updated_by: session.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("*")
    .single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.assembly",
    entity: "assembly_rates",
    entityId: "1",
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("assembly");
  return { ok: true };
}

/* ─── Weld speeds ────────────────────────────────────────── */

const weldSpeedSchema = z.object({
  id: uuidField,
  process: z.enum(WELD_SPEED_PROCESSES as [WeldProcessDb, ...WeldProcessDb[]]),
  thickness_mm: numberField({ gt: 0 }),
  speed_mm_min: numberField({ gt: 0 }),
});

export async function upsertWeldSpeed(input: WeldSpeedInput): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  const parsed = weldSpeedSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { supabase, failure } = client();
  if (failure) return failure;

  const { id, ...values } = parsed.data;
  const row = { ...values, placeholder: false, updated_by: session.user.id, updated_at: new Date().toISOString() };
  const before = id
    ? await supabase.from("weld_speeds").select("*").eq("id", id).maybeSingle()
    : await supabase.from("weld_speeds").select("*").eq("process", values.process).eq("thickness_mm", values.thickness_mm).maybeSingle();
  if (before.error) return dbFailure(before.error);
  if (id && !before.data) return { ok: false, error: "notFound" };
  const result = id
    ? await supabase.from("weld_speeds").update(row).eq("id", id).select("*").single()
    : await supabase.from("weld_speeds").upsert(row, { onConflict: "process,thickness_mm" }).select("*").single();
  if (result.error || !result.data) return dbFailure(result.error ?? { message: "no row" });

  await logAudit({
    actor: session.user.id,
    action: "settings.weld_speed",
    entity: "weld_speeds",
    entityId: String(result.data.id),
    before: before.data ? asJson(before.data) : null,
    after: asJson(result.data),
  });
  revalidateSettings("weldSpeeds");
  return { ok: true };
}

export async function deleteWeldSpeed(id: string): Promise<SettingsActionResult> {
  const session = await adminSession();
  if (!session) return FORBIDDEN;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "validation", field: "id" };
  const { supabase, failure } = client();
  if (failure) return failure;

  const before = await supabase.from("weld_speeds").select("*").eq("id", id).maybeSingle();
  if (before.error) return dbFailure(before.error);
  if (!before.data) return { ok: false, error: "notFound" };
  const { error } = await supabase.from("weld_speeds").delete().eq("id", id);
  if (error) return dbFailure(error);

  await logAudit({ actor: session.user.id, action: "settings.weld_speed", entity: "weld_speeds", entityId: id, before: asJson(before.data), after: null });
  revalidateSettings("weldSpeeds");
  return { ok: true };
}
