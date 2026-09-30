# Improvement plan — issues and possible improvements

File path: /docs/improvement-plan.md

Result of a six-dimension review of the tool on 30 Sep 2026 (sales journey,
pricing model, data and security, performance and robustness,
maintainability, admin operations): 99 evidenced findings, bug claims
verified by a second reader, synthesised below for the owner. Items 1–3 of
"Fix now" were fixed the same day (migration `20260930120000_live_rate_editing.sql`:
the active price list and the current cost basis are editable in place, the
clone copies every column, settings changes stamp the active version so
open drafts re-price); the rest is open.

## Executive summary
1. The "change prices in the front-end" feature is built but fails in production: a leftover database rule refuses every edit of the active price list as soon as one quote exists. One small change fixes it.
2. The documented workaround (copy the list, edit, activate) silently drops most market-pricing columns, so any copied list under-prices bends, threads, coatings and stainless work.
3. Price changes never reach quotes already open, and changes to service prices (welding, packaging, shipping, VAT) never trigger a re-price at all.
4. Three pricing errors cost money today: welding is sold at 0 % margin, the margin figure shown on a quote is unreliable, and placeholder rates can be sent to customers with only a green note.
5. Sales staff hit dead ends daily: refused parts have no manual price, the "forming suspected" flag cannot be cleared, and 45 % of all quote lines have no material set and therefore no price.
6. Behind that sit security gaps (staff can write prices straight to the database, any account can download every drawing), a broken fresh-install path, and slow re-pricing on large quotes.

## Fix now (bugs and high risks)
1. **Unblock editing of the active price list.** The database still treats a used version as immutable, so every save or CSV import of an existing price fails with "clone it". Add a rule exception for the active version and a real database test. Effort S.
2. **Make "copy a version" copy everything.** The copy function predates the market columns; copies come out with 0 € bend set-ups, no stainless multiplier, threads at 3 mm price for all thicknesses. Fix the copy routine and add a test that compares copy to original. Effort S.
3. **Push price changes into open drafts.** After a change, re-point all drafts to the new version, and stamp a "prices changed" clock whenever any settings table (welding speeds, packaging, shipping, VAT, machines) changes, so drafts re-price on open and export. Effort S.
4. **Stop selling welding at cost.** Welding and loose forming labour use the quote margin, which defaults to 0 % on the market list. Add a separate cost-plus margin (or the assembly floor) and show it on the line. Effort S.
5. **Repair the margin figure and its guard.** Refused parts count in cost, missing cost rows count as zero, and the guard only fires below 0 %. Sum priced items only, flag unknown costs amber, add a real minimum-margin setting. Effort S–M.
6. **Placeholder rates must warn before sending.** All packaging, shipping, assembly and weld-speed rows are unconfirmed, yet the flag is green. Make it amber when money rests on a placeholder, and add a "confirm all" button per table. Effort S.
7. **Close the two data holes.** Any sales login can overwrite prices, flags and status directly in the database (no audit trail), and any account can list and download the whole drawing bucket. Restrict those columns to the server and drop the bucket listing policy. Effort M.
8. **Give sales a way out of dead ends.** Add a per-line manual price that replaces a refusal (amber-flagged, admin-visible), show the "no forming / add forming" controls for loose parts, and keep the Flat/Bent/Rolled answer editable. Effort M.

## Next month (medium)
- **Smooth the price bands.** Fitted €/kg and set-up values are erratic (thicker sheet cheaper per dm², S355 bracket 2.3× the S235 one). Re-fit per material family and add an admin sanity view. Effort M.
- **Repair the fresh-install path.** Migrations fail on a new project and 25 database tests have been silently skipped since September; the deploy checklist and README describe stale behaviour. Effort M.
- **Faster, safer re-pricing.** Each save runs ~130 sequential database calls; uploads re-price per file. Cache the rate snapshot and persist pricing in one transaction, which also removes duplicated operation rows. Effort M.
- **Large uploads.** 100 MB files exceed function memory and a retry after a timeout duplicates parts. Set memory, lower the limit, block a second resume while one runs. Effort S–M.
- **Admin price tooling.** Per-row price history, a bulk "+8 %" adjustment, and a supplier-list import (material × thickness × €/kg) instead of hand-typed JSON bands. Effort M.
- **All-or-nothing CSV import** with a preview of changes and before/after in the audit log. Effort M.
- **Sales workflow gaps:** delete empty drafts, attach a PDF drawing by choosing it (not by file name), e-mail the requester when an override is decided. Effort M each.
- **Quote statistics page:** sent/won/lost per month, win rate, average margin per customer and sales user. Effort M.

## Later / nice to have
- Quoted-vs-actual hours per job so placeholder rates tighten from real data. Effort L.
- Tests for upload completion, PDF export guards, send and part edits; these move money and have none. Effort M–L.
- Retire the duplicate pricing paths (two pricers, two packaging rules, legacy welding-only quotes) and move remaining code constants into settings. Effort M–L.
- Login rate limiting, admin MFA, GDPR erasure for customer data, Anthropic listed as a processor. Effort M.
- Users page: deactivate, resend invite; add/remove machines and bend-table drafts from the UI. Effort M.
- One consistent row editor across admin tables; draft PDF preview with watermark; undo an accidental "sent". Effort M.
- Upgrade to Next 16 (security fixes in the framework). Effort M.

## Quick wins (effort S)

| Change | Where it helps |
|---|---|
| Update the PDF library (known code-execution flaw when opening a crafted PDF) | Security |
| Quote-level default material and thickness, amber-flagged until confirmed | Cuts the 45 % unpriced lines |
| Auto-raise lead time when a coating is added instead of turning every part red | Daily quoting |
| Apply the lead-time multiplier to assemblies and forming lines too | Pricing accuracy |
| Price masking minutes; hide rate fields that have no effect in market mode | Pricing accuracy |
| "Mark as sent without e-mail" option next to the language select | Sales |
| Mark address (and e-mail) as required on the customer form | Sales |
| "New quote" from the customer page preselects that customer; default quote language from country | Sales |
| Show the reason behind the "Blokada" chip on the upload page | Sales |
| Warn before leaving the quote header with unsaved edits; keep inputs enabled while saving | Sales |
| "Prices changed" chip in the quotes list; cost-basis marker in the versions list | Admin |
| Grid filter box and one link per service table in "Current prices" | Admin |
| Customer class as a dropdown fed from the margin map (typos now silently price at default) | Pricing accuracy |
| Shop time zone for all dates and the yearly quote number | Correctness |
| Fix admin copy and docs that still say the active list is read-only | Trust |
