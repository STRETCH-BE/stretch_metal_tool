/**
 * Pricing engine version — bumped BY HAND whenever a formula or a flag rule
 * changes what a quote is priced at, so a stored pricing computed by an
 * older engine counts as stale (lib/quotes/shared.ts isPricingStale) and a
 * draft re-prices itself once when it is opened — the same way it already
 * does when its pinned rate version changed. Pure: no env, no imports.
 * File path: /lib/pricing/version.ts
 *
 * History (what changed the numbers or the flags):
 *   1 — market v3 (28 Sep 2026): per-metre bending, thread / feature /
 *       finish rows, lead-time tiers
 *   2 — same-thickness steel fallback for the bend rate
 *       (market.bend_rate_from_steel); welding priced cost-plus from the
 *       cost version when the market version has no weld rows
 *       (market.cost_plus)
 *   3 — assembly mode (30 Sep 2026, docs/assembly-mode-design.md): welded
 *       assemblies priced as one line (parts at cost + labour + job
 *       set-ups once per job), forming operations with feasibility /
 *       step-bend / subcontract, packaging from packaging_rates, the
 *       shipping line, VAT on the net total, the price scale, and the new
 *       flags (forming.*, assembly.*, material.substituted,
 *       customer.vat_id_missing, shipping.missing)
 * A stored pricing without the field predates 2: it parses as 0 and is stale.
 */

export const PRICING_ENGINE_VERSION = 3;
