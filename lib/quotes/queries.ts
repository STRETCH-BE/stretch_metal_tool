/**
 * Quote reads — list with filters, the full quote bundle, the audit
 * excerpt and the option lists the builder needs. Server only.
 * File path: /lib/quotes/queries.ts
 *
 * Reads go through the RLS client (every signed-in role may read quotes,
 * parts, items, operations and overrides). The one exception is the audit
 * excerpt: audit_log is admin-only by policy (migration `audit_select`),
 * so `listQuoteAudit` uses the admin client — and therefore gates
 * itself: it takes the caller's Session and the quote row and returns []
 * unless the caller is an admin or the sales OWNER of that quote
 * (isQuoteEditor, the can_edit_quote() rule). A sales user may see WHO
 * changed THEIR quote (spec: "everything is audit-logged") without being
 * able to browse the whole log; viewers and other sales users see
 * nothing. The gate lives inside the function so no caller can inherit
 * the RLS bypass by forgetting a role check. A missing service-role key
 * degrades to an empty excerpt instead of breaking the quote page.
 *
 * Aggregates (parts count, pending overrides, customer/owner names) are
 * computed in TypeScript from narrow secondary queries instead of
 * PostgREST embeds, which keeps the hand-written Database types honest.
 * `loadQuoteBundle(client, id)` takes the client explicitly so the
 * re-pricing glue can run it with the admin client when asked to.
 *
 * Assembly mode: the bundle also carries the quote's assemblies (position
 * order), their seams (assembly, then position) and the company_settings
 * row. A database that lags the code (assembly-mode migration not applied:
 * PostgREST PGRST205 / Postgres 42P01) reads those as empty / null instead
 * of taking the quote page down; any other error surfaces like every
 * table. company_settings is read here directly (not through
 * lib/rates/load) so the quote tests that mock the rate loader keep
 * working; the numeric / boolean coercion lives in the mapper.
 */

import type { Session } from "@/lib/auth";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { createAdminClient, type AdminSupabase } from "@/lib/supabase/admin";
import type { AssemblyRow, AssemblySeamRow, CustomerRow, OperationRow, OverrideRow, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { companyRowToSettings } from "./mapper";
import { parseFlags, parsePricing, parseWeldingOnly } from "./schema";
import { isQuoteEditor, isUuid, worstSeverity } from "./shared";
import type { QuoteAuditRow, QuoteBundle, QuoteListFilters, QuoteListResult, QuoteListRow } from "./types";

export type QuoteReadClient = ServerSupabase | AdminSupabase;

export const QUOTES_PAGE_SIZE = 50;

type DbError = { message: string; code?: string } | null;

async function rows<T>(query: PromiseLike<{ data: unknown; error: DbError }>, what: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as T[];
}

/** PostgREST ("not in the schema cache") and Postgres (undefined_table) codes for a table that does not exist. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

/** Like rows(), but a table the deployed database does not have yet reads as empty (logged, never silent). */
async function optionalRows<T>(query: PromiseLike<{ data: unknown; error: DbError }>, what: string, table: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    if (error.code && MISSING_TABLE_CODES.has(error.code)) {
      console.warn(`[quotes] ${table} is missing (${error.code}) — apply supabase/migrations/20260930100000_assembly_mode.sql`);
      return [];
    }
    throw new Error(`${what}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

/** PostgREST `or()` filters are comma/paren delimited — strip those and wildcards. */
function sanitizeSearch(search: string): string {
  return search.replace(/[,()%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function listQuotes(filters: QuoteListFilters = {}): Promise<QuoteListResult> {
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(filters.pageSize ?? QUOTES_PAGE_SIZE, 1), 200);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const search = sanitizeSearch(filters.search ?? "");

  let matchingCustomerIds: string[] = [];
  if (search) {
    const customers = await rows<Pick<CustomerRow, "id">>(
      supabase.from("customers").select("id").ilike("name", `%${search}%`).limit(200),
      "listQuotes/customers"
    );
    matchingCustomerIds = customers.map((c) => c.id);
  }

  let query = supabase.from("quotes").select("*", { count: "exact" }).order("updated_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.customerId && isUuid(filters.customerId)) query = query.eq("customer_id", filters.customerId);
  if (search) {
    const parts = [`number.ilike.%${search}%`];
    if (matchingCustomerIds.length > 0) parts.push(`customer_id.in.(${matchingCustomerIds.join(",")})`);
    query = query.or(parts.join(","));
  }
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(`listQuotes: ${error.message}`);
  const quotes = (data ?? []) as QuoteRow[];
  const total = count ?? 0;

  const ids = quotes.map((q) => q.id);
  const customerIds = Array.from(new Set(quotes.map((q) => q.customer_id).filter((v): v is string => Boolean(v))));
  const ownerIds = Array.from(new Set(quotes.map((q) => q.created_by).filter((v): v is string => Boolean(v))));

  const [customers, owners, items, pending] = await Promise.all([
    customerIds.length
      ? rows<Pick<CustomerRow, "id" | "name">>(supabase.from("customers").select("id, name").in("id", customerIds), "listQuotes/customers")
      : Promise.resolve([]),
    ownerIds.length
      ? rows<{ id: string; full_name: string | null; email: string }>(
          supabase.from("profiles").select("id, full_name, email").in("id", ownerIds),
          "listQuotes/profiles"
        )
      : Promise.resolve([]),
    ids.length
      ? rows<Pick<QuoteItemRow, "quote_id">>(supabase.from("quote_items").select("quote_id").in("quote_id", ids), "listQuotes/items")
      : Promise.resolve([]),
    ids.length
      ? rows<Pick<OverrideRow, "quote_id">>(
          supabase.from("overrides").select("quote_id").in("quote_id", ids).eq("status", "pending"),
          "listQuotes/overrides"
        )
      : Promise.resolve([]),
  ]);

  const customerName = new Map(customers.map((c) => [c.id, c.name] as const));
  const ownerName = new Map(owners.map((o) => [o.id, o.full_name?.trim() || o.email] as const));
  const partsCount = new Map<string, number>();
  for (const item of items) partsCount.set(item.quote_id, (partsCount.get(item.quote_id) ?? 0) + 1);
  const pendingCount = new Map<string, number>();
  for (const o of pending) pendingCount.set(o.quote_id, (pendingCount.get(o.quote_id) ?? 0) + 1);

  const listRows: QuoteListRow[] = quotes.map((q) => ({
    id: q.id,
    number: q.number,
    version: q.version,
    type: q.type,
    status: q.status,
    currency: q.currency,
    customerId: q.customer_id,
    customerName: q.customer_id ? (customerName.get(q.customer_id) ?? null) : null,
    partsCount: partsCount.get(q.id) ?? 0,
    totalPrice: Number(q.subtotal_price) || 0,
    worstSeverity: worstSeverity(parseFlags(q.flags)),
    pendingOverrides: pendingCount.get(q.id) ?? 0,
    updatedAt: q.updated_at,
    createdAt: q.created_at,
    ownerId: q.created_by,
    ownerName: q.created_by ? (ownerName.get(q.created_by) ?? null) : null,
  }));

  return { rows: listRows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)), pageSize };
}

/** Full bundle with an explicit client (RLS or admin). Null when the quote is not visible. */
export async function loadQuoteBundle(client: QuoteReadClient, quoteId: string): Promise<QuoteBundle | null> {
  if (!isUuid(quoteId)) return null;
  const { data: quote, error } = await client.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) throw new Error(`loadQuoteBundle: ${error.message}`);
  if (!quote) return null;

  const [customer, items, parts, overrides, version, costVersion] = await Promise.all([
    quote.customer_id
      ? client
          .from("customers")
          .select("*")
          .eq("id", quote.customer_id)
          .maybeSingle()
          .then(({ data, error: e }) => {
            if (e) throw new Error(`loadQuoteBundle/customer: ${e.message}`);
            return (data ?? null) as CustomerRow | null;
          })
      : Promise.resolve(null),
    rows<QuoteItemRow>(
      client.from("quote_items").select("*").eq("quote_id", quoteId).order("position").order("created_at"),
      "loadQuoteBundle/items"
    ),
    rows<PartRow>(client.from("parts").select("*").eq("quote_id", quoteId).order("created_at"), "loadQuoteBundle/parts"),
    rows<OverrideRow>(
      client.from("overrides").select("*").eq("quote_id", quoteId).order("created_at"),
      "loadQuoteBundle/overrides"
    ),
    quote.rate_version_id
      ? client
          .from("rate_versions")
          .select("label")
          .eq("id", quote.rate_version_id)
          .maybeSingle()
          .then(({ data }) => (data as { label: string } | null)?.label ?? null)
      : Promise.resolve(null),
    quote.cost_rate_version_id
      ? client
          .from("rate_versions")
          .select("label")
          .eq("id", quote.cost_rate_version_id)
          .maybeSingle()
          .then(({ data }) => (data as { label: string } | null)?.label ?? null)
      : Promise.resolve(null),
  ]);

  const itemIds = items.map((i) => i.id);
  const [operations, assemblies, companyRows] = await Promise.all([
    itemIds.length
      ? rows<OperationRow>(
          client.from("operations").select("*").in("quote_item_id", itemIds).order("position"),
          "loadQuoteBundle/operations"
        )
      : Promise.resolve([] as OperationRow[]),
    optionalRows<AssemblyRow>(
      client.from("assemblies").select("*").eq("quote_id", quoteId).order("position").order("created_at"),
      "loadQuoteBundle/assemblies",
      "assemblies"
    ),
    optionalRows<Record<string, unknown>>(client.from("company_settings").select("*").eq("id", 1).limit(1), "loadQuoteBundle/company", "company_settings"),
  ]);
  const assemblyIds = assemblies.map((a) => a.id);
  const seams = assemblyIds.length
    ? await optionalRows<AssemblySeamRow>(
        client.from("assembly_seams").select("*").in("assembly_id", assemblyIds).order("position").order("created_at"),
        "loadQuoteBundle/seams",
        "assembly_seams"
      )
    : [];
  const assemblyOrder = new Map(assemblyIds.map((id, index) => [id, index] as const));
  seams.sort((a, b) => (assemblyOrder.get(a.assembly_id) ?? 0) - (assemblyOrder.get(b.assembly_id) ?? 0) || Number(a.position) - Number(b.position));

  return {
    quote: quote as QuoteRow,
    customer,
    items,
    parts,
    operations,
    overrides,
    rateVersionLabel: version,
    costRateVersionLabel: costVersion,
    pricing: parsePricing(quote.pricing),
    flags: parseFlags(quote.flags),
    weldingOnly: parseWeldingOnly(quote.welding_only),
    assemblies,
    seams,
    company: companyRowToSettings(companyRows[0] ?? null),
  };
}

/** Bundle as the signed-in user (RLS). */
export async function getQuoteBundle(quoteId: string): Promise<QuoteBundle | null> {
  const supabase = await createClient();
  return loadQuoteBundle(supabase, quoteId);
}

/** Versions that exist for a quote number (for duplicate-as-new-version). */
export async function listQuoteVersions(client: QuoteReadClient, number: string): Promise<{ id: string; version: number }[]> {
  return rows<{ id: string; version: number }>(
    client.from("quotes").select("id, version").eq("number", number).order("version"),
    "listQuoteVersions"
  );
}

/** Customers for the header/new-quote selects (id, name, country, class, e-mail, locale, type, contact person). */
/** customer_type is null on a database that lags the assembly-mode migration (the send guard then asks for it). */
export type CustomerOption = Pick<CustomerRow, "id" | "name" | "country" | "customer_class" | "email" | "preferred_locale" | "contact_person"> & { customer_type: CustomerRow["customer_type"] | null };

export async function listCustomerOptions(): Promise<CustomerOption[]> {
  const supabase = await createClient();
  // select("*") rather than naming customer_type / contact_person: a database
  // that lags the assembly-mode migration has no such columns and PostgREST
  // would refuse the whole query (42703); the picker then reads them as null.
  const all = await rows<CustomerRow>(supabase.from("customers").select("*").order("name").limit(500), "listCustomerOptions");
  return all.map((c) => ({
    id: c.id,
    name: c.name,
    country: c.country,
    customer_class: c.customer_class,
    email: c.email,
    preferred_locale: c.preferred_locale,
    customer_type: c.customer_type ?? null,
    contact_person: c.contact_person ?? null,
  }));
}

/** Who may read a quote's audit excerpt: an admin or the owning sales user. */
export function canSeeQuoteAudit(session: Session | null, quote: Pick<QuoteRow, "created_by">): boolean {
  return Boolean(session && isQuoteEditor(session.profile.role, session.user.id, quote));
}

/**
 * Last audit entries about this quote: rows whose entity_id is the quote
 * or whose `after.quote_id` points at it (override rows). Admin client
 * behind the admin-or-owner gate — see the file header. Never throws:
 * a missing service-role key (or a failing query) yields [] and a server
 * log line, so the quote page still renders.
 */
export async function listQuoteAudit(
  session: Session | null,
  quote: Pick<QuoteRow, "id" | "created_by">,
  limit = 20
): Promise<QuoteAuditRow[]> {
  const quoteId = quote.id;
  if (!isUuid(quoteId)) return [];
  if (!canSeeQuoteAudit(session, quote)) return [];
  try {
    return await readQuoteAudit(quoteId, limit);
  } catch (error) {
    console.error("[quotes] audit excerpt unavailable", quoteId, error);
    return [];
  }
}

async function readQuoteAudit(quoteId: string, limit: number): Promise<QuoteAuditRow[]> {
  const admin = createAdminClient();
  const entries = await rows<{ id: number; action: string; actor: string | null; at: string }>(
    admin
      .from("audit_log")
      .select("id, action, actor, at")
      .or(`entity_id.eq.${quoteId},after->>quote_id.eq.${quoteId}`)
      .order("at", { ascending: false })
      .limit(limit),
    "listQuoteAudit"
  );
  const actorIds = Array.from(new Set(entries.map((e) => e.actor).filter((v): v is string => Boolean(v))));
  const actors = actorIds.length
    ? await rows<{ id: string; full_name: string | null; email: string }>(
        admin.from("profiles").select("id, full_name, email").in("id", actorIds),
        "listQuoteAudit/profiles"
      )
    : [];
  const names = new Map(actors.map((a) => [a.id, a.full_name?.trim() || a.email] as const));
  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    actor: e.actor,
    actorName: e.actor ? (names.get(e.actor) ?? null) : null,
    at: e.at,
  }));
}
