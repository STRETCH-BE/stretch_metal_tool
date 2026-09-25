/**
 * Customer reads — list with search + pagination, single customer, and
 * the customer's quote history. Server only (RLS client as the user:
 * every signed-in role may read customers and quotes).
 * File path: /lib/customers/queries.ts
 *
 * Quote counts / last-quote dates are aggregated in TypeScript from a
 * second, narrow query (customer_id, created_at) instead of PostgREST
 * aggregates, which keeps the hand-written Database types honest and
 * needs no extra view. Volumes are small (one sales team).
 */

import { createClient } from "@/lib/supabase/server";
import type { CustomerRow, QuoteRow } from "@/lib/db/types";

export const CUSTOMERS_PAGE_SIZE = 50;

export type CustomerListRow = CustomerRow & {
  quoteCount: number;
  lastQuoteAt: string | null;
};

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  search: string;
};

export type ListCustomersParams = {
  search?: string;
  page?: number;
  pageSize?: number;
};

/** PostgREST `or()` filters are comma/paren delimited — strip those and wildcards. */
function sanitizeSearch(search: string): string {
  return search.replace(/[,()%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function listCustomers(
  params: ListCustomersParams = {}
): Promise<CustomerListResult> {
  const pageSize = Math.min(Math.max(params.pageSize ?? CUSTOMERS_PAGE_SIZE, 1), 200);
  const requestedPage = Math.max(1, Math.floor(params.page ?? 1));
  const search = sanitizeSearch(params.search ?? "");

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("*", { count: "exact" })
    .order("name", { ascending: true });

  if (search) {
    const pattern = `%${search}%`;
    query = query.or(
      `name.ilike.${pattern},vat_id.ilike.${pattern},email.ilike.${pattern}`
    );
  }

  const from = (requestedPage - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(`listCustomers: ${error.message}`);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const customers = data ?? [];

  const stats = await quoteStatsFor(customers.map((c) => c.id));
  const rows: CustomerListRow[] = customers.map((customer) => ({
    ...customer,
    quoteCount: stats.get(customer.id)?.count ?? 0,
    lastQuoteAt: stats.get(customer.id)?.lastAt ?? null,
  }));

  return { rows, total, page: requestedPage, pageCount, pageSize, search };
}

async function quoteStatsFor(
  customerIds: string[]
): Promise<Map<string, { count: number; lastAt: string }>> {
  const stats = new Map<string, { count: number; lastAt: string }>();
  if (customerIds.length === 0) return stats;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select("customer_id, created_at")
    .in("customer_id", customerIds);
  if (error) throw new Error(`quoteStatsFor: ${error.message}`);

  for (const row of data ?? []) {
    if (!row.customer_id) continue;
    const current = stats.get(row.customer_id);
    if (!current) {
      stats.set(row.customer_id, { count: 1, lastAt: row.created_at });
    } else {
      current.count += 1;
      if (row.created_at > current.lastAt) current.lastAt = row.created_at;
    }
  }
  return stats;
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getCustomer: ${error.message}`);
  return data ?? null;
}

/** Columns the history table shows — narrow on purpose (no pricing JSON). */
export type CustomerQuoteRow = Pick<
  QuoteRow,
  | "id"
  | "number"
  | "version"
  | "type"
  | "status"
  | "currency"
  | "subtotal_price"
  | "created_at"
  | "sent_at"
  | "updated_at"
>;

export async function listCustomerQuotes(
  customerId: string,
  limit = 100
): Promise<CustomerQuoteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, number, version, type, status, currency, subtotal_price, created_at, sent_at, updated_at"
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listCustomerQuotes: ${error.message}`);
  return data ?? [];
}
