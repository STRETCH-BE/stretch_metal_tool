/**
 * Pure quote helpers — safe for client components, the PDF and tests
 * (no Next, no Supabase, no env).
 * File path: /lib/quotes/shared.ts
 *
 * Decisions:
 *   - Number label: "SM-2026-0001" for version 1, "SM-2026-0001-v2" from
 *     version 2 (build prompt Step 2). The base number never changes when
 *     a quote is duplicated as a new version.
 *   - Versions of one number are counted from the rows that exist: the
 *     next version is max(version) + 1, never "current + 1", so duplicating
 *     an old v1 while a v3 exists yields v4 (unique (number, version)).
 *   - Override ↔ flag matching: an override covers a flag when its
 *     rule_code equals the flag code and its part scope equals the flag's
 *     partId (quote-level flags have partId null). itemId is stored for
 *     the UI but not part of the match — one part = one item per quote.
 *   - The default PDF/e-mail locale is the customer's preference, else
 *     Polish (the company's home market).
 *   - Stale pricing: quotes.pricing remembers the rate version, the
 *     pricing-engine version (lib/pricing/version.ts), the margin and the
 *     lead time it was computed with, and quotes.subtotal_* were written by
 *     the same run in the currency of that moment. When any of them
 *     disagrees with the header now saved on the quote or with the engine
 *     now deployed (a draft re-pinned to a newly activated version, a header
 *     save whose server re-price failed, a deploy that changed a formula or
 *     a flag rule) the stored numbers are stale and the builder re-prices
 *     the draft on open (isPricingStale).
 *   - Totals table: OPERATION_TYPE_ORDER lists EVERY operation type, the
 *     market price components (order charge, packaging, lead time) included,
 *     so the rows of the summary add up to the total. The PDF operation
 *     summary (summariseOperations) leaves those components out: they sit
 *     inside the part price and are not work done on the part.
 */

import type { UserLocale } from "@/lib/db/types";
import { toQuoteCurrency } from "@/lib/format";
import type { Flag, FlagSeverity, OperationLine, OperationType, PricedQuote } from "@/lib/pricing/types";
import { PRICING_ENGINE_VERSION } from "@/lib/pricing/version";
import type { Locale } from "@/lib/site-config";
import type { OverrideKey } from "./types";

export function quoteNumberLabel(quote: { number: string; version: number }): string {
  return quote.version > 1 ? `${quote.number}-v${quote.version}` : quote.number;
}

/** File name of the quote PDF: "SM-2026-0001.pdf" / "SM-2026-0001-v2.pdf". */
export function quotePdfFileName(quote: { number: string; version: number }, locale?: Locale): string {
  const suffix = locale ? `-${locale.toUpperCase()}` : "";
  return `${quoteNumberLabel(quote)}${suffix}.pdf`;
}

/** Next version number for a quote number given the versions that already exist. */
export function nextVersionNumber(existingVersions: number[]): number {
  let max = 0;
  for (const v of existingVersions) if (Number.isFinite(v) && v > max) max = v;
  return max + 1;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { green: 0, amber: 1, red: 2 };

/** The most severe flag level in the list, or null when there are no flags. */
export function worstSeverity(flags: ReadonlyArray<Pick<Flag, "severity">>): FlagSeverity | null {
  let worst: FlagSeverity | null = null;
  for (const flag of flags) {
    if (worst === null || SEVERITY_RANK[flag.severity] > SEVERITY_RANK[worst]) worst = flag.severity;
  }
  return worst;
}

export function flagsBySeverity<T extends Pick<Flag, "severity">>(
  flags: ReadonlyArray<T>
): Record<FlagSeverity, T[]> {
  const out: Record<FlagSeverity, T[]> = { red: [], amber: [], green: [] };
  for (const flag of flags) out[flag.severity].push(flag);
  return out;
}

/** Stable key for a flag (deduplicates repeated rule hits on the same part). */
export function flagKey(flag: OverrideKey): string {
  return `${flag.code}|${flag.partId ?? ""}`;
}

export function overrideMatchesFlag(
  override: { rule_code: string; part_id: string | null },
  flag: { code: string; partId: string | null }
): boolean {
  return override.rule_code === flag.code && (override.part_id ?? null) === (flag.partId ?? null);
}

/** Locale the customer should receive: explicit param → customer preference → pl. */
export function resolveQuoteLocale(
  requested: string | null | undefined,
  customerPreferred: UserLocale | null | undefined
): Locale {
  if (requested === "pl" || requested === "en") return requested;
  if (customerPreferred === "pl" || customerPreferred === "en") return customerPreferred;
  return "pl";
}

/** Validity end date = created (or sent) date + validity days, ISO date string (UTC). */
export function validUntilDate(from: string | Date, validityDays: number): Date {
  const start = typeof from === "string" ? new Date(from) : new Date(from.getTime());
  const days = Number.isFinite(validityDays) && validityDays > 0 ? Math.floor(validityDays) : 0;
  start.setUTCDate(start.getUTCDate() + days);
  return start;
}

/** Every operation type in display order for the totals table (a type missing here would hide its money from the summary). */
export const OPERATION_TYPE_ORDER: OperationType[] = [
  "laser_cut",
  "subcontract_cutting",
  "tube_cut",
  "material",
  "bend",
  "roll",
  "weld",
  "thread",
  "feature",
  "machining",
  "finish_powder",
  "finish_zinc",
  "finish_deburr",
  "finish_other",
  "engrave",
  "handling",
  "setup",
  "order",
  "packaging",
  "shipping",
  "leadtime",
  "other",
];

/** Market price components that are money, not work: inside the part price, never listed as an operation on the PDF. */
export const PRICE_COMPONENT_TYPES: ReadonlySet<OperationType> = new Set<OperationType>(["order", "packaging", "shipping", "leadtime"]);

/** Group operation lines by type keeping order — used by the PDF operation summary (price components skipped). */
export function summariseOperations(lines: ReadonlyArray<OperationLine>): { type: OperationType; count: number; unitCost: number }[] {
  const map = new Map<OperationType, { type: OperationType; count: number; unitCost: number }>();
  for (const line of lines) {
    if (PRICE_COMPONENT_TYPES.has(line.type)) continue;
    const entry = map.get(line.type) ?? { type: line.type, count: 0, unitCost: 0 };
    entry.count += 1;
    entry.unitCost += line.unitCost;
    map.set(line.type, entry);
  }
  return OPERATION_TYPE_ORDER.filter((t) => map.has(t)).map((t) => map.get(t)!);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Mirror of the can_edit_quote() SQL function: admin, or a writer who owns the quote. */
export function isQuoteEditor(
  role: "admin" | "sales" | "viewer",
  userId: string,
  quote: { created_by: string | null }
): boolean {
  if (role === "admin") return true;
  return role === "sales" && quote.created_by === userId;
}

/** Quotes that may still be edited: drafts and quotes waiting for an override decision. */
export function isQuoteEditable(status: "draft" | "pending_override" | "sent" | "won" | "lost"): boolean {
  return status === "draft" || status === "pending_override";
}

/** Money tolerance for the stored subtotal check: quotes.subtotal_* are numeric(14,4). */
const SUBTOTAL_TOLERANCE = 0.01;
const PCT_TOLERANCE = 1e-6;

export type StalePricingQuote = {
  rate_version_id: string | null;
  margin_pct: number | string;
  lead_time_days: number | string | null;
  currency: "PLN" | "EUR";
  fx_rate: number | string;
  subtotal_price: number | string;
  /** When the snapshot was written; a customer edited after it changes the VAT inputs. */
  priced_at?: string | null;
};

/** What isPricingStale reads from the stored snapshot; engineVersion is absent on snapshots stored before the engine was versioned. */
export type StalePricingSnapshot = Pick<PricedQuote, "rateVersionId" | "inputMarginPct" | "leadTimeDays" | "subtotalPrice"> & { engineVersion?: number };

/**
 * The stored pricing no longer matches the quote it belongs to: computed by
 * an older pricing engine (PRICING_ENGINE_VERSION; a snapshot without the
 * field counts as 0), with a different rate version than the one the quote
 * is pinned to now, with a different margin or lead time than the header
 * carries, or its quote-currency subtotal (written by the same run)
 * disagrees with the EUR snapshot converted at the currency and fx rate
 * saved now. The last three happen when a header save could not be
 * re-priced on the server. Unpriced quotes are never stale; an unpinned
 * quote only through the engine version and its inputs (the first pricing
 * run pins it).
 */
export function isPricingStale(quote: StalePricingQuote, pricing: StalePricingSnapshot | null, customerUpdatedAt: string | null = null): boolean {
  if (pricing === null) return false;
  // The VAT mode, rate and gross come from the customer's type, country and
  // VAT id at pricing time; a customer saved after that is a new input.
  if (customerUpdatedAt && quote.priced_at) {
    const edited = Date.parse(customerUpdatedAt);
    const priced = Date.parse(quote.priced_at);
    if (Number.isFinite(edited) && Number.isFinite(priced) && edited > priced) return true;
  }
  if ((pricing.engineVersion ?? 0) !== PRICING_ENGINE_VERSION) return true;
  if (quote.rate_version_id !== null && pricing.rateVersionId !== quote.rate_version_id) return true;
  const margin = Number(quote.margin_pct);
  if (Number.isFinite(margin) && Math.abs(pricing.inputMarginPct - margin) > PCT_TOLERANCE) return true;
  const lead = quote.lead_time_days === null ? null : Number(quote.lead_time_days);
  if (lead !== null && Number.isFinite(lead) && lead > 0 && pricing.leadTimeDays !== null && Math.abs(pricing.leadTimeDays - lead) > PCT_TOLERANCE) return true;
  const fx = Number(quote.fx_rate) || 1;
  const expected = toQuoteCurrency(pricing.subtotalPrice, quote.currency, fx);
  return Math.abs(Number(quote.subtotal_price) - expected) > SUBTOTAL_TOLERANCE;
}
