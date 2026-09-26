/**
 * Quote access checks for server actions, route handlers and the
 * re-pricing glue — one place that answers "may this user change this
 * quote?" the same way the can_edit_quote() SQL function does.
 * File path: /lib/quotes/access.ts
 *
 * The RLS client (as the user) reads the quote: a viewer/sales user who
 * cannot see it gets notFound rather than a distinguishable 403. Editing
 * requires a write role AND (admin or ownership); the same rule gates the
 * admin-client persistence writes in lib/quotes/reprice.ts, which is why
 * every caller of the admin client goes through here first.
 */

import { getCurrentUser, type Session } from "@/lib/auth";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type { QuoteRow } from "@/lib/db/types";
import { isQuoteEditor, isUuid } from "./shared";

export type QuoteAccessCode = "unauthenticated" | "forbidden" | "notFound" | "locked";

export class QuoteAccessError extends Error {
  readonly code: QuoteAccessCode;
  constructor(code: QuoteAccessCode, message?: string) {
    super(message ?? code);
    this.name = "QuoteAccessError";
    this.code = code;
  }
}

export type QuoteEditor = { session: Session; supabase: ServerSupabase; quote: QuoteRow };

/**
 * Session + quote for a mutation. Throws QuoteAccessError:
 * unauthenticated (no session), forbidden (viewer or not the owner),
 * notFound (bad id / invisible row), locked (status sent/won/lost when
 * `options.editableOnly`).
 */
export async function requireQuoteEditor(
  quoteId: string,
  options: { editableOnly?: boolean } = {}
): Promise<QuoteEditor> {
  const session = await getCurrentUser();
  if (!session) throw new QuoteAccessError("unauthenticated");
  if (!isUuid(quoteId)) throw new QuoteAccessError("notFound");
  const supabase = await createClient();
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) throw new Error(`requireQuoteEditor: ${error.message}`);
  if (!quote) throw new QuoteAccessError("notFound");
  if (!isQuoteEditor(session.profile.role, session.user.id, quote)) throw new QuoteAccessError("forbidden");
  if (options.editableOnly && quote.status !== "draft" && quote.status !== "pending_override") {
    throw new QuoteAccessError("locked");
  }
  return { session, supabase, quote };
}

/** Read-side variant: any signed-in role, quote visible through RLS. */
export async function requireQuoteReader(quoteId: string): Promise<QuoteEditor> {
  const session = await getCurrentUser();
  if (!session) throw new QuoteAccessError("unauthenticated");
  if (!isUuid(quoteId)) throw new QuoteAccessError("notFound");
  const supabase = await createClient();
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) throw new Error(`requireQuoteReader: ${error.message}`);
  if (!quote) throw new QuoteAccessError("notFound");
  return { session, supabase, quote };
}
