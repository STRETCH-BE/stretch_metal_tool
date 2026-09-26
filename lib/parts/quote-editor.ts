/**
 * Pure mirror of the SQL rule `public.can_edit_quote(quote)` for rows the
 * server already holds: admin, or the sales owner of the quote.
 * File path: /lib/parts/quote-editor.ts
 *
 * Used where a row's AUTHOR must be checked rather than the current
 * session — the intake only trusts a companion PDF (files row) whose
 * uploader may edit the quote it is filed under. `files` carries no
 * quote_id and its insert policy only checks uploaded_by = auth.uid(), so
 * any can_write user can file a row (and an object) under another user's
 * quote folder; this predicate is what keeps such a row out of another
 * owner's parts (review finding on intake-db.findPdfByBaseName). The
 * schema-level fix (files.quote_id + RLS, storage insert policy limited
 * to the signed-upload path) belongs to the migration owner.
 */

import type { UserRole } from "@/lib/db/types";

export type QuoteOwnership = { created_by: string | null };
export type QuoteEditor = { id: string; role: UserRole };

/** Same rule as SQL can_edit_quote: is_admin() or (created_by = uid and can_write()). */
export function canEditQuoteAs(quote: QuoteOwnership, user: QuoteEditor | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "sales" && quote.created_by !== null && quote.created_by === user.id;
}
