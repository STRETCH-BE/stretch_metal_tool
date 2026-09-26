# Quotes (`lib/quotes`)

Server-side glue between the quote tables, the pure pricing engine and
the UI: re-pricing, reads, server actions, the send guard and sending.
Every price the app stores comes from `repriceQuote()`; the client only
previews with the same pure functions (`components/quote/preview.ts`).

```
reprice.ts     repriceQuote(quoteId, { admin? })        → PricedQuote | null   (the ONLY price writer)
queries.ts     listQuotes, getQuoteBundle/loadQuoteBundle, listQuoteAudit, listCustomerOptions
actions.ts     "use server": createQuote, updateQuoteHeader, updateItem, removeItem, addItem,
               reorderItems, updateWeldingOnly, duplicateAsNewVersion, requestOverride,
               confirmFlag, setQuoteStatus, sendQuoteAction, repriceQuoteAction
send.ts        sendQuote(quoteId, { locale }) → { sent, mailed, pdfPath }, buildQuoteEmail
send-guard.ts  canSend(bundle) → { ok, reasons[] }                              (pure)
mapper.ts      rows → QuoteInput, PricedQuote → row updates                     (pure)
schema.ts      zod guards for stored JSON + every action input                  (pure)
shared.ts      quoteNumberLabel, nextVersionNumber, worstSeverity, …            (pure)
access.ts      requireQuoteEditor / requireQuoteReader (+ QuoteAccessError)
create.ts      createDraftQuote (shared with the upload flow)
types.ts       QuoteBundle, QuoteListRow, SendCheck, …
```

## Trust model

- Reads as the user (RLS). Writes of the pricing result go through the
  admin client, but only after `requireQuoteEditor` (admin, or the sales
  owner — the same rule as `can_edit_quote()` in SQL) or with
  `{ admin: true }` from a trusted, already role-checked caller.
- Every mutation that changes a price input ends with `repriceQuote`
  (Step 12: the server re-prices on save and on send).
- `quotes.rate_version_id` is pinned on the first pricing run and never
  moved; "duplicate as new version" re-pins to the active version.

## Money

Engine amounts are EUR: `quotes.pricing`, `quote_items.unit_cost/_price`
and `operations.unit_cost` stay EUR. `quotes.subtotal_cost/_price` are
stored in the quote currency (`fx_rate`) because the list views and the
customer history display them with `quote.currency`.

## Send rules (`send-guard.ts`)

Blocked when: any red flag (never overridable — a red `*.no_rate_row`
would ship an operation at 0 €), any pending override, an amber flag
without acceptance, no customer, nothing priced, status not draft.

**Amber acceptance = an `overrides` row.** There is no acknowledgement
column on `quotes`; a sales "confirm" inserts an override with
`status = 'approved'`, `decided_by = requested_by` and the note
`confirmed by sales` (`actions.ts` `confirmFlag`, admin client). An admin
approval from the queue is the same row shape with `decided_by` = the
admin. One matching rule (`overrideMatchesFlag`: rule code + part scope)
covers both, and the UI labels the self-approved rows "confirmed by
sales". A rejected override leaves the flag uncovered.

`pending_override` with no pending rows left counts as sendable (the
admin queue flips the status back on decision; a stale status must not
block a decided quote).

## Sending (`send.ts`)

1. `repriceQuote` → 2. `canSend` on the fresh bundle → 3. render the PDF
(`lib/pdf`) → 4. upload to `quote-files` (`quotes/<id>/<stamp>-<label>.pdf`)
+ `files` row (`kind = quote_pdf`) → 5. `sendMail` when `isMailConfigured()`
and the customer has an e-mail (a mail failure keeps the PDF and the
status, `mailed: false`) → 6. `status = sent`, `sent_at` → 7. audit
`quote.send`. Locale: param → `customer.preferred_locale` → `pl`.

## Tests

`test/quotes/*` (shared helpers, send-guard truth table, mapper +
real engine run, reprice with a fake client, actions), `test/pdf/*`
(render in both locales and currencies, text assertions, page-count
snapshot). `test/quotes/fake-supabase.ts` is the in-memory PostgREST
stand-in used by the server-side tests.
