# Rate workbooks

`scripts/seed-market-rates.mjs` loads a **market** rate version (the tables are
selling prices, e.g. 247TailorSteel × 1.10) from an `.xlsx` workbook placed in this
folder — `stretchmetal_rates_247plus10.xlsx` (committed; sha256 in `rate_versions.note`
after a load).

Sheet names are table names, header cells are column names (aliases in the
script's `ALIASES`; anything not consumed is listed as "not mapped" in the run
report, never dropped silently):

| Sheet | Columns used |
|---|---|
| `settings` | `key` / `value` rows — `rate_version_name` names the version (created if missing, never activated by the script) |
| `materials_price_bands` | `material_code`, `max_thickness_mm`, `price_per_kg_sell` (optional `name`, `family`, `density_kg_m3`, `rm_n_mm2` for a material the source version lacks) |
| `rate_laser` | `material_code`, `thickness_mm`, `price_per_m_sell`, `price_per_pierce_sell`, `setup_eur_sell`, `gas`, `min_contour_mm`, `source` (interpolated / extrapolated ⇒ placeholder) |
| `rate_finish` | `code`, `price_sell`, `setup_per_order_sell` (optional `unit`, `name`, `min_part_mm`) — `deburr` is €/m with the minimum part rule, `engrave` is per part |
| `rate_general` | `key` / `value_sell` rows — `order_charge_eur`, `packaging_box_eur`, `packaging_pallet_eur` (other rate_general keys are accepted too) |
| `rate_leadtime` | `working_days`, `multiplier` |
| `247_base`, `import_notes` | documentation, not imported |

Every other rate row is copied from the source version (the placeholder cost
version by default) and the fixed market settings are applied: `pricing_mode =
market`, `labour_rate_eur_h = 25`, `blank_margin_mm = 0`, `default_margin_pct = 30`.

```sh
# Write the idempotent SQL (source rows from the committed JSON export)
node scripts/seed-market-rates.mjs docs/rates/stretchmetal_rates_247plus10.xlsx \
  --source-json test/fixtures/rates/placeholder-v1.json \
  --sql /tmp/market.sql --export-json test/fixtures/rates/market-247plus10.json

# Apply it (Postgres connection string from Supabase → Database → Connection)
SUPABASE_DB_URL='postgresql://…' node scripts/seed-market-rates.mjs docs/rates/stretchmetal_rates_247plus10.xlsx --apply

# Or fetch the source rows from the project instead of the JSON
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-market-rates.mjs … --apply
```

Re-running is safe: the SQL finds the version by its label, replaces its rows when
no quote uses it yet, and is a no-op when quotes use it and the workbook fingerprint
(sha256 in `rate_versions.note`) is unchanged — a changed workbook against a used
version is refused (load it under a new `rate_version_name`). Each run writes an
`audit_log` entry `rate_version.seed` with the file, its sha256 and the row counts.
The exported JSON (`--export-json`) is what `test/rates/market-247.test.ts` prices
against, so the market version cannot drift from the workbook unnoticed.
