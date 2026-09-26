/**
 * Access checks for the intake routes and part actions — SERVER ONLY.
 * File path: /lib/parts/access.ts
 *
 * Every mutation of a quote's files/parts/items runs through
 * requireQuoteWriter / requirePartWriter: a session with a WRITE role
 * (admin, sales), the quote visible through RLS, the SQL can_edit_quote()
 * RPC (admin, or the sales owner — the same rule the policies enforce)
 * and an editable quote (draft or pending_override, geometry not locked).
 * Reads (requirePartReader) need any signed-in role. Failures throw
 * PartAccessError with a code the route maps to 401/403/404/409 and the
 * server actions map to a content-coded error.
 */

import { NextResponse } from "next/server";
import { getCurrentUser, WRITE_ROLES, type Session } from "@/lib/auth";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type { PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import { isUuid } from "./schema";

export type PartAccessCode = "unauthenticated" | "forbidden" | "not_found" | "locked" | "invalid_id";

export class PartAccessError extends Error {
  constructor(public readonly code: PartAccessCode) {
    super(`part access: ${code}`);
    this.name = "PartAccessError";
  }
}

export type QuoteWriter = { session: Session; supabase: ServerSupabase; quote: QuoteRow };
export type PartWriter = QuoteWriter & { part: PartRow; item: QuoteItemRow | null };
export type PartReader = { session: Session; supabase: ServerSupabase; quote: QuoteRow; part: PartRow; item: QuoteItemRow | null };

/** Draft / pending-override quotes whose geometry is not locked. */
export function isQuoteEditable(quote: Pick<QuoteRow, "status" | "geometry_locked">): boolean {
  return (quote.status === "draft" || quote.status === "pending_override") && !quote.geometry_locked;
}

async function canEditQuote(supabase: ServerSupabase, quoteId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_edit_quote", { p_quote: quoteId });
  if (error) throw new Error(`can_edit_quote: ${error.message}`);
  return data === true;
}

export async function requireQuoteWriter(quoteId: string): Promise<QuoteWriter> {
  const session = await getCurrentUser();
  if (!session) throw new PartAccessError("unauthenticated");
  if (!WRITE_ROLES.includes(session.profile.role)) throw new PartAccessError("forbidden");
  if (!isUuid(quoteId)) throw new PartAccessError("invalid_id");
  const supabase = await createClient();
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) throw new Error(`quotes select: ${error.message}`);
  if (!quote) throw new PartAccessError("not_found");
  if (!(await canEditQuote(supabase, quoteId))) throw new PartAccessError("forbidden");
  if (!isQuoteEditable(quote)) throw new PartAccessError("locked");
  return { session, supabase, quote };
}

async function loadPartAndItem(supabase: ServerSupabase, partId: string): Promise<{ part: PartRow; item: QuoteItemRow | null } | null> {
  const { data: part, error } = await supabase.from("parts").select("*").eq("id", partId).maybeSingle();
  if (error) throw new Error(`parts select: ${error.message}`);
  if (!part) return null;
  const { data: item, error: itemError } = await supabase.from("quote_items").select("*").eq("part_id", partId).maybeSingle();
  if (itemError) throw new Error(`quote_items select: ${itemError.message}`);
  return { part, item: item ?? null };
}

export async function requirePartWriter(partId: string): Promise<PartWriter> {
  if (!isUuid(partId)) throw new PartAccessError("invalid_id");
  const session = await getCurrentUser();
  if (!session) throw new PartAccessError("unauthenticated");
  if (!WRITE_ROLES.includes(session.profile.role)) throw new PartAccessError("forbidden");
  const supabase = await createClient();
  const loaded = await loadPartAndItem(supabase, partId);
  if (!loaded) throw new PartAccessError("not_found");
  const writer = await requireQuoteWriter(loaded.part.quote_id);
  return { ...writer, part: loaded.part, item: loaded.item };
}

/** Any signed-in role; the part must be visible through RLS. */
export async function requirePartReader(partId: string): Promise<PartReader> {
  if (!isUuid(partId)) throw new PartAccessError("invalid_id");
  const session = await getCurrentUser();
  if (!session) throw new PartAccessError("unauthenticated");
  const supabase = await createClient();
  const loaded = await loadPartAndItem(supabase, partId);
  if (!loaded) throw new PartAccessError("not_found");
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("id", loaded.part.quote_id).maybeSingle();
  if (error) throw new Error(`quotes select: ${error.message}`);
  if (!quote) throw new PartAccessError("not_found");
  return { session, supabase, quote, part: loaded.part, item: loaded.item };
}

const STATUS: Record<PartAccessCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_id: 404,
  locked: 409,
};

export function accessErrorCode(error: unknown): PartAccessCode | null {
  return error instanceof PartAccessError ? error.code : null;
}

/** Route-handler mapping; null for errors that are not access errors. */
export function accessErrorResponse(error: unknown): NextResponse | null {
  const code = accessErrorCode(error);
  if (!code) return null;
  return NextResponse.json({ error: code }, { status: STATUS[code] });
}
