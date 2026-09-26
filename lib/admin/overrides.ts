/**
 * Override queue — pending / decided lists with their quote context, and
 * decideOverride() (approve or reject with a note).
 * File path: /lib/admin/overrides.ts
 *
 * decideOverride is the unit of work the server action calls after the
 * role check: it flips the override, and when the quote has no pending
 * override left and sits in `pending_override`, moves it back to `draft`
 * so sales can continue. Both changes are audit-logged
 * (override.approve|reject, quote.status). The Supabase client is
 * injectable for tests; by default the RLS server client is used (the
 * overrides_update and quotes_update policies allow admins).
 *
 * List joins are done in TypeScript from narrow queries (quotes,
 * customers, parts, profiles) — no PostgREST embedding against the
 * hand-written Database types.
 */

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Json, OverrideRow, OverrideStatus, ProfileRow } from "@/lib/db/types";
import type { AdminClient } from "@/lib/admin/rates";

export type OverrideListRow = OverrideRow & {
  quote: { id: string; number: string; version: number; status: string; customerId: string | null } | null;
  customerName: string | null;
  partName: string | null;
  requesterName: string | null;
  deciderName: string | null;
};

export type ListOverridesParams = {
  status: "pending" | "decided";
  /** Decided list only: narrow to one outcome. */
  decidedStatus?: "approved" | "rejected" | null;
  search?: string;
  limit?: number;
};

export type DecideOverrideInput = {
  overrideId: string;
  decision: "approve" | "reject";
  note: string;
  actorId: string;
};

export type DecideOverrideResult =
  | { ok: true; override: OverrideRow; quoteReverted: boolean }
  | { ok: false; error: "notFound" | "alreadyDecided" | "noteRequired" | "db"; message?: string };

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

function asJson(value: unknown): Json | null {
  return value === null || value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);
}

export async function listOverrides(supabase: AdminClient, params: ListOverridesParams): Promise<OverrideListRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  let query = supabase.from("overrides").select("*");
  if (params.status === "pending") {
    query = query.eq("status", "pending").order("created_at", { ascending: true });
  } else if (params.decidedStatus) {
    query = query.eq("status", params.decidedStatus).order("decided_at", { ascending: false });
  } else {
    query = query.in("status", ["approved", "rejected"]).order("decided_at", { ascending: false });
  }
  const { data, error } = await query.limit(limit);
  if (error) fail("listOverrides", error);
  const overrides = (data ?? []) as OverrideRow[];
  if (overrides.length === 0) return [];

  const quoteIds = [...new Set(overrides.map((o) => o.quote_id))];
  const partIds = [...new Set(overrides.map((o) => o.part_id).filter((id): id is string => Boolean(id)))];
  const userIds = [
    ...new Set(
      overrides.flatMap((o) => [o.requested_by, o.decided_by]).filter((id): id is string => Boolean(id))
    ),
  ];

  const [quotesRes, partsRes, usersRes] = await Promise.all([
    supabase.from("quotes").select("id, number, version, status, customer_id").in("id", quoteIds),
    partIds.length ? supabase.from("parts").select("id, name").in("id", partIds) : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (quotesRes.error) fail("listOverrides quotes", quotesRes.error);
  if (partsRes.error) fail("listOverrides parts", partsRes.error);
  if (usersRes.error) fail("listOverrides profiles", usersRes.error);

  const quotes = new Map(
    ((quotesRes.data ?? []) as { id: string; number: string; version: number; status: string; customer_id: string | null }[]).map(
      (q) => [q.id, q] as const
    )
  );
  const customerIds = [...new Set([...quotes.values()].map((q) => q.customer_id).filter((id): id is string => Boolean(id)))];
  const customers = new Map<string, string>();
  if (customerIds.length > 0) {
    const res = await supabase.from("customers").select("id, name").in("id", customerIds);
    if (res.error) fail("listOverrides customers", res.error);
    for (const c of (res.data ?? []) as { id: string; name: string }[]) customers.set(c.id, c.name);
  }
  const parts = new Map(((partsRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name] as const));
  const users = new Map(
    ((usersRes.data ?? []) as Pick<ProfileRow, "id" | "full_name" | "email">[]).map(
      (u) => [u.id, u.full_name?.trim() || u.email] as const
    )
  );

  const search = (params.search ?? "").trim().toLowerCase();
  const rows: OverrideListRow[] = overrides.map((o) => {
    const quote = quotes.get(o.quote_id);
    return {
      ...o,
      quote: quote
        ? { id: quote.id, number: quote.number, version: quote.version, status: quote.status, customerId: quote.customer_id }
        : null,
      customerName: quote?.customer_id ? (customers.get(quote.customer_id) ?? null) : null,
      partName: o.part_id ? (parts.get(o.part_id) ?? null) : null,
      requesterName: o.requested_by ? (users.get(o.requested_by) ?? null) : null,
      deciderName: o.decided_by ? (users.get(o.decided_by) ?? null) : null,
    };
  });
  if (!search) return rows;
  return rows.filter((row) =>
    [row.quote?.number, row.customerName, row.partName, row.rule_code, row.note, row.decision_note, row.requesterName]
      .filter((v): v is string => Boolean(v))
      .some((v) => v.toLowerCase().includes(search))
  );
}

export async function countPendingOverrides(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from("overrides")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) fail("countPendingOverrides", error);
  return count ?? 0;
}

/**
 * Approve or reject one pending override. The caller has already verified
 * the actor is an admin. A rejection requires a note.
 */
export async function decideOverride(
  input: DecideOverrideInput,
  client?: AdminClient
): Promise<DecideOverrideResult> {
  const note = input.note.trim();
  if (input.decision === "reject" && !note) return { ok: false, error: "noteRequired" };
  const supabase = client ?? (await createClient());

  const existing = await supabase.from("overrides").select("*").eq("id", input.overrideId).maybeSingle();
  if (existing.error) return { ok: false, error: "db", message: existing.error.message };
  if (!existing.data) return { ok: false, error: "notFound" };
  const before = existing.data as OverrideRow;
  if (before.status !== "pending") return { ok: false, error: "alreadyDecided" };

  const status: OverrideStatus = input.decision === "approve" ? "approved" : "rejected";
  const decidedAt = new Date().toISOString();
  const updated = await supabase
    .from("overrides")
    .update({ status, decided_by: input.actorId, decided_at: decidedAt, decision_note: note || null })
    .eq("id", input.overrideId)
    .select("*")
    .single();
  if (updated.error || !updated.data) return { ok: false, error: "db", message: updated.error?.message };
  const after = updated.data as OverrideRow;

  await logAudit({
    actor: input.actorId,
    action: `override.${input.decision}`,
    entity: "overrides",
    entityId: after.id,
    before: asJson(before),
    after: asJson(after),
  });

  // Quote back to draft when nothing is pending any more.
  let quoteReverted = false;
  const pending = await supabase
    .from("overrides")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", before.quote_id)
    .eq("status", "pending");
  if (!pending.error && (pending.count ?? 0) === 0) {
    const quote = await supabase.from("quotes").select("id, status").eq("id", before.quote_id).maybeSingle();
    if (!quote.error && quote.data && quote.data.status === "pending_override") {
      const reverted = await supabase.from("quotes").update({ status: "draft" }).eq("id", before.quote_id);
      if (!reverted.error) {
        quoteReverted = true;
        await logAudit({
          actor: input.actorId,
          action: "quote.status",
          entity: "quotes",
          entityId: before.quote_id,
          before: { status: "pending_override" },
          after: { status: "draft", reason: `override.${input.decision}` },
        });
      }
    }
  }

  return { ok: true, override: after, quoteReverted };
}
