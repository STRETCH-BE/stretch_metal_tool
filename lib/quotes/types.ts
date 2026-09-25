/**
 * Quote domain types shared by the server (queries, reprice, send), the
 * client islands (builder, preview) and the PDF — plain data, no I/O.
 * File path: /lib/quotes/types.ts
 *
 * `QuoteBundle` is the one shape every consumer reads: the quote row, its
 * customer, the items in position order with their parts, the persisted
 * operation rows, the overrides and the parsed pricing snapshot. Money in
 * `pricing` / `operations` / `quote_items.unit_*` is EUR (engine truth);
 * `quotes.subtotal_cost/_price` are stored in the QUOTE CURRENCY (see
 * lib/quotes/reprice.ts) because the list views and the customer history
 * display them with `quote.currency`.
 */

import type {
  CurrencyCode,
  CustomerRow,
  OperationRow,
  OverrideRow,
  PartRow,
  QuoteItemRow,
  QuoteRow,
  QuoteStatus,
  QuoteTypeDb,
} from "@/lib/db/types";
import type { Flag, FlagSeverity, PricedQuote, WeldingOnlySeam } from "@/lib/pricing/types";

/** Welding-only block as stored in quotes.welding_only. */
export type WeldingOnlyBlock = {
  seams: WeldingOnlySeam[];
  partsCount: number;
};

export type QuoteBundle = {
  quote: QuoteRow;
  customer: CustomerRow | null;
  /** Items in position order. */
  items: QuoteItemRow[];
  /** Every part of the quote (items reference them; unattached parts may exist right after upload). */
  parts: PartRow[];
  /** Persisted operation rows of every item, in position order. */
  operations: OperationRow[];
  overrides: OverrideRow[];
  rateVersionLabel: string | null;
  /** quotes.pricing parsed, or null before the first pricing run. */
  pricing: PricedQuote | null;
  /** quotes.flags parsed. */
  flags: Flag[];
  /** quotes.welding_only parsed. */
  weldingOnly: WeldingOnlyBlock | null;
};

export type QuoteListRow = {
  id: string;
  number: string;
  version: number;
  type: QuoteTypeDb;
  status: QuoteStatus;
  currency: CurrencyCode;
  customerId: string | null;
  customerName: string | null;
  partsCount: number;
  /** Batch total in the quote currency (net). */
  totalPrice: number;
  worstSeverity: FlagSeverity | null;
  pendingOverrides: number;
  updatedAt: string;
  createdAt: string;
  ownerId: string | null;
  ownerName: string | null;
};

export type QuoteListResult = {
  rows: QuoteListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

export type QuoteListFilters = {
  status?: QuoteStatus | null;
  customerId?: string | null;
  search?: string;
  page?: number;
  pageSize?: number;
};

/** Why a quote cannot be sent — keys of content.quote.send.reasons. */
export type SendBlockReason =
  | "red_flags"
  | "pending_override"
  | "amber_unconfirmed"
  | "no_customer"
  | "no_customer_email"
  | "no_items"
  | "not_priced"
  | "status";

export type SendCheck = {
  ok: boolean;
  reasons: SendBlockReason[];
};

export type SendResult =
  | { sent: true; mailed: boolean; pdfPath: string }
  | { sent: false; mailed: false; pdfPath: null; reasons: SendBlockReason[] };

/** Audit excerpt row shown on the quote page. */
export type QuoteAuditRow = {
  id: number;
  action: string;
  actor: string | null;
  actorName: string | null;
  at: string;
};

export type OverrideKey = {
  code: string;
  partId: string | null;
  itemId: string | null;
};
