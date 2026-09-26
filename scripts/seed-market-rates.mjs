#!/usr/bin/env node
/**
 * Seed a MARKET rate version from the 247TailorSteel workbook
 * (docs/rates/stretchmetal_rates_247plus10.xlsx — selling prices = 247 × 1.10).
 * File path: /scripts/seed-market-rates.mjs
 *
 *   node scripts/seed-market-rates.mjs <workbook.xlsx> [options]
 *     --source-json <file>     rows of the source (cost) version as JSON
 *                              (test/fixtures/rates/placeholder-v1.json shape);
 *                              without it the rows are fetched from Supabase
 *                              (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *     --source-version <uuid>  version to copy (default: the placeholder
 *                              00000000-0000-4000-8000-000000000001, else the active one)
 *     --sql <file>             write the idempotent SQL (default: stdout when no --apply)
 *     --apply                  run the SQL with psql against $SUPABASE_DB_URL (or $DATABASE_URL)
 *     --export-json <file>     write the computed version rows (for tests / review)
 *     --dry-run                only print the mapping report
 *
 * What it does (rate-version rules from the owner, 26 Sep 2026):
 *   1. settings!rate_version_name names the version (created if missing,
 *      never activated — the admin activates it).
 *   2. Every rate table row of the source version is copied, then
 *      overwritten in the NEW version only:
 *      - materials: price_per_kg bands from materials_price_bands
 *        (max thickness, price_per_kg_sell), scrap_pct_default 0, placeholder false;
 *      - rate_laser: upsert per (material_code, thickness_mm) in-house row —
 *        mode per_m, price_per_m_sell, price_per_pierce_sell, setup_eur_sell,
 *        gas, min_contour_mm; placeholder = true only when `source` says
 *        interpolated / extrapolated;
 *      - rate_finish: deburr price_sell per m + setup_per_order_sell +
 *        min_part_mm ("steel 250x60 or 600x50; aluminium/stainless 50x50");
 *        engrave unit 'part', price_sell;
 *      - rate_general: order_charge_eur, packaging_box_eur,
 *        packaging_pallet_eur (rate_general sheet, value_sell), pricing_mode
 *        'market', labour_rate_eur_h 25, blank_margin_mm 0, default_margin_pct 30;
 *      - rate_leadtime: the rows of the rate_leadtime sheet.
 *   3. Sheet names are table names, headers are column names; aliases are
 *      accepted (see ALIASES) and everything not consumed is listed as
 *      "unmapped" in the report so nothing is silently dropped.
 *
 * Idempotent / re-runnable: the SQL is one DO block. It finds the version
 * by label, refuses to touch a version that quotes already use unless the
 * workbook fingerprint (sha256 in rate_versions.note) is unchanged — then
 * it is a no-op — and otherwise replaces every rate row of the version
 * with the computed set. Every run writes an audit_log entry
 * ("rate_version.seed") with the file, its sha256 and the row counts, as
 * the admin rate editor does for its edits. The source version is never
 * modified.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { readWorkbook } from "./lib/xlsx.mjs";

export const PLACEHOLDER_VERSION_ID = "00000000-0000-4000-8000-000000000001";
export const DEBURR_MIN_PART_MM = "steel 250x60 or 600x50; aluminium/stainless 50x50";
export const MARKET_LABOUR_RATE_EUR_H = 25;
export const MARKET_BLANK_MARGIN_MM = 0;
export const MARKET_DEFAULT_MARGIN_PCT = 30;

/** Sheet names (table names) the workbook is expected to carry. */
export const SHEETS = {
  settings: ["settings"],
  materials: ["materials_price_bands", "materials"],
  laser: ["rate_laser", "laser"],
  finish: ["rate_finish", "finish"],
  general: ["rate_general", "general"],
  leadtime: ["rate_leadtime", "leadtime", "lead_time"],
};

/** Column aliases per logical field (compared after normalisation). */
export const ALIASES = {
  key: ["key", "setting", "name", "parameter", "column"],
  value: ["value"],
  valueSell: ["value_sell", "sell", "value_247plus10"],
  materialCode: ["material_code", "material", "code"],
  maxThicknessMm: ["max_thickness_mm", "maxthicknessmm", "thickness_max_mm", "max_thickness", "up_to_mm", "thickness_mm"],
  pricePerKgSell: ["price_per_kg_sell", "priceperkgsell", "price_kg_sell", "sell_per_kg"],
  thicknessMm: ["thickness_mm", "thickness", "t_mm"],
  pricePerMSell: ["price_per_m_sell", "price_m_sell", "sell_per_m"],
  pricePerPierceSell: ["price_per_pierce_sell", "pierce_sell", "sell_per_pierce"],
  setupEurSell: ["setup_eur_sell", "setup_sell", "setup_eur"],
  gas: ["gas"],
  minContourMm: ["min_contour_mm", "min_contour"],
  source: ["source", "origin", "basis"],
  code: ["code", "finish_code"],
  priceSell: ["price_sell", "sell_price", "price"],
  setupPerOrderSell: ["setup_per_order_sell", "setup_per_order_eur", "setup_sell", "setup_per_order"],
  unit: ["unit"],
  finishName: ["name", "label"],
  minPartMm: ["min_part_mm", "min_part", "minimum_part_mm"],
  workingDays: ["working_days", "days", "lead_time_days"],
  multiplier: ["multiplier", "factor", "price_factor"],
  family: ["family", "material_family"],
  density: ["density_kg_m3", "density"],
  rm: ["rm_n_mm2", "rm"],
  materialName: ["name", "material_name"],
};

/* ─── helpers ─────────────────────────────────────────────── */

export function normaliseName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function findHeader(headers, aliases) {
  const wanted = aliases.map(normaliseName);
  for (const alias of wanted) {
    const hit = headers.find((h) => normaliseName(h) === alias);
    if (hit !== undefined) return hit;
  }
  return null;
}

function toNumber(value, where) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(",", ".").replace(/\s/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${where}: expected a number, got ${JSON.stringify(value)}`);
  return n;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function gasOf(value) {
  const v = toText(value)?.toLowerCase() ?? null;
  if (v === null) return null;
  if (v === "o2" || v === "oxygen") return "O2";
  if (v === "n2" || v === "nitrogen") return "N2";
  if (v === "air") return "air";
  return null;
}

function sheetOf(workbook, names) {
  for (const name of names) {
    for (const [sheetName, sheet] of workbook.sheets) {
      if (normaliseName(sheetName) === normaliseName(name)) return { name: sheetName, sheet };
    }
  }
  return null;
}

/** A column reader that records which headers were used (for the unmapped report). */
function columns(sheet, sheetName, report) {
  const used = new Set();
  const get = (record, aliases, { required = false, field = aliases[0] } = {}) => {
    const header = findHeader(sheet.headers, aliases);
    if (header === null) {
      if (required) throw new Error(`sheet "${sheetName}": column "${field}" not found (headers: ${sheet.headers.join(", ")})`);
      return undefined;
    }
    used.add(header);
    return record[header];
  };
  const finish = () => {
    for (const header of sheet.headers) {
      if (!used.has(header)) report.unmapped.push(`${sheetName}!${header} (column not used)`);
    }
  };
  return { get, finish };
}

/* ─── settings ────────────────────────────────────────────── */

export function readSettings(workbook, report) {
  const found = sheetOf(workbook, SHEETS.settings);
  if (!found) throw new Error('sheet "settings" not found');
  const { sheet, name } = found;
  const settings = {};
  const keyHeader = findHeader(sheet.headers, ALIASES.key);
  const valueHeader = findHeader(sheet.headers, ALIASES.value);
  if (keyHeader && valueHeader) {
    for (const { values } of sheet.records) {
      const key = toText(values[keyHeader]);
      if (key) settings[normaliseName(key)] = values[valueHeader];
    }
    for (const header of sheet.headers) {
      if (header !== keyHeader && header !== valueHeader) report.unmapped.push(`${name}!${header} (column not used)`);
    }
  } else {
    // One row of headers = keys.
    const first = sheet.records[0]?.values ?? {};
    for (const header of sheet.headers) settings[normaliseName(header)] = first[header];
  }
  const label = toText(settings.rate_version_name);
  if (!label) throw new Error('settings!rate_version_name is missing — it names the rate version');
  report.mapped.push(`${name}: rate_version_name = "${label}"`);
  for (const key of Object.keys(settings)) {
    if (key !== "rate_version_name") report.unmapped.push(`${name}!${key} = ${JSON.stringify(settings[key])} (setting not used)`);
  }
  return { label, settings };
}

/* ─── build the version rows ──────────────────────────────── */

function cloneRows(rows) {
  return JSON.parse(JSON.stringify(rows ?? []));
}

/**
 * source: { general, materials, laser, tubeLaser, bend, roll, weld, thread,
 * feature, finish, leadtime? } with DB column names (the JSON export of the
 * placeholder version). Returns the rows of the new version (without
 * rate_version_id / id) + a mapping report.
 */
export function buildMarketVersion(workbook, source) {
  const report = { mapped: [], unmapped: [], warnings: [] };
  const { label, settings } = readSettings(workbook, report);

  // Sheets we knowingly ignore (documentation), everything else unknown → unmapped.
  const known = new Set(Object.values(SHEETS).flat().map(normaliseName));
  for (const sheetName of workbook.sheets.keys()) {
    const n = normaliseName(sheetName);
    if (n === "247_base" || n === "import_notes") report.unmapped.push(`sheet "${sheetName}" (documentation, not imported)`);
    else if (!known.has(n)) report.unmapped.push(`sheet "${sheetName}" (no table with this name)`);
  }

  // Columns added by the market-pricing migration may be missing in an older
  // JSON export of the source version: default them like the DB would.
  const general = { order_charge_eur: 0, packaging_box_eur: 0, packaging_pallet_eur: 0, pricing_mode: "cost", ...cloneRows([source.general])[0] };
  const materials = cloneRows(source.materials);
  const laser = cloneRows(source.laser).map((r) => ({ setup_eur: 0, ...r, setup_eur: r.setup_eur ?? 0 }));
  const finish = cloneRows(source.finish).map((r) => ({ ...r, setup_per_order_eur: r.setup_per_order_eur ?? 0, min_part_mm: r.min_part_mm ?? null }));
  const tubeLaser = cloneRows(source.tubeLaser);
  const bend = cloneRows(source.bend);
  const roll = cloneRows(source.roll);
  const weld = cloneRows(source.weld);
  const thread = cloneRows(source.thread);
  const feature = cloneRows(source.feature);
  let leadtime = cloneRows(source.leadtime ?? []);

  // ── materials_price_bands ──
  const mats = sheetOf(workbook, SHEETS.materials);
  if (!mats) throw new Error('sheet "materials_price_bands" not found');
  {
    const { get, finish: done } = columns(mats.sheet, mats.name, report);
    const bands = new Map();
    const extra = new Map();
    for (const { values, row } of mats.sheet.records) {
      const code = toText(get(values, ALIASES.materialCode, { required: true, field: "material_code" }));
      const maxT = toNumber(get(values, ALIASES.maxThicknessMm, { required: true, field: "max_thickness_mm" }), `${mats.name} row ${row} max thickness`);
      const price = toNumber(get(values, ALIASES.pricePerKgSell, { required: true, field: "price_per_kg_sell" }), `${mats.name} row ${row} price_per_kg_sell`);
      if (!code || maxT === null || price === null) {
        report.warnings.push(`${mats.name} row ${row}: incomplete band skipped`);
        continue;
      }
      if (!bands.has(code)) bands.set(code, []);
      bands.get(code).push({ maxThicknessMm: maxT, pricePerKg: price });
      const meta = {
        name: toText(get(values, ALIASES.materialName)),
        family: toText(get(values, ALIASES.family)),
        density: toNumber(get(values, ALIASES.density), `${mats.name} row ${row} density`),
        rm: toNumber(get(values, ALIASES.rm), `${mats.name} row ${row} rm`),
      };
      if (!extra.has(code)) extra.set(code, meta);
    }
    done();
    for (const [code, list] of bands) {
      list.sort((a, b) => a.maxThicknessMm - b.maxThicknessMm);
      const existing = materials.find((m) => m.code.toLowerCase() === code.toLowerCase());
      if (existing) {
        existing.price_per_kg = list;
        existing.scrap_pct_default = 0;
        existing.placeholder = false;
        report.mapped.push(`materials.${existing.code}: ${list.length} band(s) from ${mats.name}, scrap 0`);
      } else {
        const meta = extra.get(code);
        if (meta.family && meta.density !== null && meta.rm !== null) {
          materials.push({
            code,
            name: meta.name ?? code,
            family: meta.family,
            density_kg_m3: meta.density,
            rm_n_mm2: meta.rm,
            price_per_kg: list,
            sheet_formats: [],
            scrap_pct_default: 0,
            placeholder: false,
          });
          report.mapped.push(`materials.${code}: NEW material from ${mats.name}`);
        } else {
          report.unmapped.push(`${mats.name}: material "${code}" is not in the source version and has no family/density/rm columns — skipped`);
        }
      }
    }
  }

  // ── rate_laser ──
  const las = sheetOf(workbook, SHEETS.laser);
  if (!las) throw new Error('sheet "rate_laser" not found');
  {
    const { get, finish: done } = columns(las.sheet, las.name, report);
    let upserts = 0;
    let replaced = 0;
    let interpolated = 0;
    for (const { values, row } of las.sheet.records) {
      const where = `${las.name} row ${row}`;
      const code = toText(get(values, ALIASES.materialCode, { required: true, field: "material_code" }));
      const t = toNumber(get(values, ALIASES.thicknessMm, { required: true, field: "thickness_mm" }), `${where} thickness`);
      const perM = toNumber(get(values, ALIASES.pricePerMSell, { required: true, field: "price_per_m_sell" }), `${where} price_per_m_sell`);
      const perPierce = toNumber(get(values, ALIASES.pricePerPierceSell, { required: true, field: "price_per_pierce_sell" }), `${where} price_per_pierce_sell`);
      const setup = toNumber(get(values, ALIASES.setupEurSell, { required: true, field: "setup_eur_sell" }), `${where} setup_eur_sell`);
      const gas = gasOf(get(values, ALIASES.gas));
      const minContour = toNumber(get(values, ALIASES.minContourMm), `${where} min_contour_mm`);
      const sourceText = toText(get(values, ALIASES.source)) ?? "";
      if (!code || t === null || perM === null) {
        report.warnings.push(`${where}: incomplete laser row skipped`);
        continue;
      }
      if (!materials.some((m) => m.code.toLowerCase() === code.toLowerCase())) {
        report.unmapped.push(`${where}: material "${code}" has no materials row — laser row skipped (FK)`);
        continue;
      }
      const placeholder = /interpol|extrapol/i.test(sourceText);
      if (placeholder) interpolated += 1;
      const rowValues = {
        material_code: materials.find((m) => m.code.toLowerCase() === code.toLowerCase()).code,
        thickness_mm: t,
        mode: "per_m",
        speed_m_min: null,
        pierce_s: null,
        price_per_m: perM,
        price_per_pierce: perPierce ?? 0,
        gas,
        min_contour_mm: minContour,
        in_house: true,
        supplier: null,
        placeholder,
        setup_eur: setup ?? 0,
      };
      const index = laser.findIndex((r) => r.in_house && r.material_code.toLowerCase() === code.toLowerCase() && Math.abs(Number(r.thickness_mm) - t) < 1e-6);
      if (index >= 0) {
        laser[index] = { ...laser[index], ...rowValues };
        replaced += 1;
      } else {
        laser.push(rowValues);
      }
      upserts += 1;
    }
    done();
    report.mapped.push(`rate_laser: ${upserts} in-house per-metre row(s) from ${las.name} (${replaced} replaced, ${upserts - replaced} added, ${interpolated} kept as placeholder: interpolated/extrapolated)`);
  }

  // ── rate_finish ──
  const fin = sheetOf(workbook, SHEETS.finish);
  if (!fin) throw new Error('sheet "rate_finish" not found');
  {
    const { get, finish: done } = columns(fin.sheet, fin.name, report);
    for (const { values, row } of fin.sheet.records) {
      const where = `${fin.name} row ${row}`;
      const code = toText(get(values, ALIASES.code, { required: true, field: "code" }));
      const price = toNumber(get(values, ALIASES.priceSell, { required: true, field: "price_sell" }), `${where} price_sell`);
      const setup = toNumber(get(values, ALIASES.setupPerOrderSell), `${where} setup_per_order_sell`);
      const unitText = toText(get(values, ALIASES.unit));
      const name = toText(get(values, ALIASES.finishName));
      const minPart = toText(get(values, ALIASES.minPartMm));
      if (!code || price === null) {
        report.warnings.push(`${where}: incomplete finish row skipped`);
        continue;
      }
      const lower = code.toLowerCase();
      let target = finish.find((f) => f.code.toLowerCase() === lower);
      if (!target) {
        target = { code: lower, name: name ?? code, unit: "each", price: 0, minimum: 0, placeholder: false, setup_per_order_eur: 0, min_part_mm: null };
        finish.push(target);
      }
      target.price = price;
      target.placeholder = false;
      if (name) target.name = name;
      if (lower === "deburr") {
        target.unit = "m";
        target.setup_per_order_eur = setup ?? 0;
        target.min_part_mm = minPart ?? DEBURR_MIN_PART_MM;
        report.mapped.push(`rate_finish.deburr: ${price} €/m, setup per order ${target.setup_per_order_eur} €, min part "${target.min_part_mm}"`);
      } else if (lower === "engrave") {
        target.unit = "part";
        if (setup !== null) target.setup_per_order_eur = setup;
        report.mapped.push(`rate_finish.engrave: ${price} € per part`);
      } else {
        if (unitText) target.unit = unitText;
        if (setup !== null) target.setup_per_order_eur = setup;
        report.mapped.push(`rate_finish.${lower}: ${price} per ${target.unit}`);
      }
    }
    done();
  }

  // ── rate_general ──
  const gen = sheetOf(workbook, SHEETS.general);
  if (!gen) throw new Error('sheet "rate_general" not found');
  {
    const keyHeader = findHeader(gen.sheet.headers, ALIASES.key);
    const sellHeader = findHeader(gen.sheet.headers, ALIASES.valueSell);
    const GENERAL_KEYS = new Set([
      "machine_rate_eur_h", "labour_rate_eur_h", "machining_rate_eur_h", "default_margin_pct", "blank_margin_mm",
      "slow_contour_factor", "default_stitch_bead_mm", "default_stitch_pitch_mm", "handling_mass_limit_kg",
      "handling_surcharge_eur", "weld_handling_per_part", "order_charge_eur", "packaging_box_eur", "packaging_pallet_eur",
    ]);
    const KEY_ALIASES = { order_charge: "order_charge_eur", packaging_box: "packaging_box_eur", packaging_pallet: "packaging_pallet_eur", order_charge_sell: "order_charge_eur" };
    const applied = [];
    if (keyHeader && sellHeader) {
      for (const { values, row } of gen.sheet.records) {
        const rawKey = toText(values[keyHeader]);
        if (!rawKey) continue;
        let key = normaliseName(rawKey);
        key = KEY_ALIASES[key] ?? key;
        if (!GENERAL_KEYS.has(key)) {
          report.unmapped.push(`${gen.name}!${rawKey} = ${JSON.stringify(values[sellHeader])} (no rate_general column)`);
          continue;
        }
        const value = toNumber(values[sellHeader], `${gen.name} row ${row} ${rawKey}`);
        if (value !== null) {
          general[key] = value;
          applied.push(`${key} = ${value}`);
        } else {
          report.warnings.push(`${gen.name} row ${row}: ${rawKey} has no value_sell`);
        }
      }
      for (const header of gen.sheet.headers) {
        if (header !== keyHeader && header !== sellHeader) report.unmapped.push(`${gen.name}!${header} (column not used)`);
      }
    } else {
      // Column-per-key layout.
      const first = gen.sheet.records[0]?.values ?? {};
      for (const header of gen.sheet.headers) {
        let key = normaliseName(header).replace(/_sell$/, "");
        key = KEY_ALIASES[key] ?? key;
        if (!GENERAL_KEYS.has(key)) {
          report.unmapped.push(`${gen.name}!${header} (no rate_general column)`);
          continue;
        }
        const value = toNumber(first[header], `${gen.name} ${header}`);
        if (value !== null) {
          general[key] = value;
          applied.push(`${key} = ${value}`);
        } else report.unmapped.push(`${gen.name}!${header} (no rate_general column)`);
      }
    }
    for (const required of ["order_charge_eur", "packaging_box_eur", "packaging_pallet_eur"]) {
      if (!applied.some((a) => a.startsWith(`${required} =`))) report.warnings.push(`${gen.name}: ${required} not found — kept ${general[required] ?? 0}`);
    }
    general.pricing_mode = "market";
    general.labour_rate_eur_h = MARKET_LABOUR_RATE_EUR_H;
    general.blank_margin_mm = MARKET_BLANK_MARGIN_MM;
    general.default_margin_pct = MARKET_DEFAULT_MARGIN_PCT;
    general.order_charge_eur = general.order_charge_eur ?? 0;
    general.packaging_box_eur = general.packaging_box_eur ?? 0;
    general.packaging_pallet_eur = general.packaging_pallet_eur ?? 0;
    general.placeholder = false;
    report.mapped.push(`rate_general: ${applied.join(", ") || "(nothing from the sheet)"}; pricing_mode market, labour ${MARKET_LABOUR_RATE_EUR_H} €/h, blank margin ${MARKET_BLANK_MARGIN_MM} mm, default margin ${MARKET_DEFAULT_MARGIN_PCT} %`);
  }

  // ── rate_leadtime ──
  const lt = sheetOf(workbook, SHEETS.leadtime);
  if (!lt) throw new Error('sheet "rate_leadtime" not found');
  {
    const { get, finish: done } = columns(lt.sheet, lt.name, report);
    const rows = [];
    for (const { values, row } of lt.sheet.records) {
      const days = toNumber(get(values, ALIASES.workingDays, { required: true, field: "working_days" }), `${lt.name} row ${row} working_days`);
      const multiplier = toNumber(get(values, ALIASES.multiplier, { required: true, field: "multiplier" }), `${lt.name} row ${row} multiplier`);
      if (days === null || multiplier === null) {
        report.warnings.push(`${lt.name} row ${row}: incomplete lead-time row skipped`);
        continue;
      }
      rows.push({ working_days: Math.round(days), multiplier, placeholder: false });
    }
    done();
    rows.sort((a, b) => a.working_days - b.working_days);
    leadtime = rows;
    report.mapped.push(`rate_leadtime: ${rows.map((r) => `${r.working_days} d → ×${r.multiplier}`).join(", ")}`);
  }

  return {
    label,
    settings,
    rows: { general, materials, laser, tubeLaser, bend, roll, weld, thread, feature, finish, leadtime },
    report,
  };
}

/* ─── SQL rendering ───────────────────────────────────────── */

function lit(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

const TABLE_COLUMNS = {
  materials: ["code", "name", "family", "density_kg_m3", "rm_n_mm2", "price_per_kg", "sheet_formats", "scrap_pct_default", "placeholder"],
  rate_laser: ["material_code", "thickness_mm", "mode", "speed_m_min", "pierce_s", "price_per_m", "price_per_pierce", "gas", "min_contour_mm", "in_house", "supplier", "placeholder", "setup_eur"],
  rate_tube_laser: ["profile_family", "wall_mm", "price_per_m_cut", "handling_per_part", "setup", "placeholder"],
  rate_bend: ["thickness_mm", "length_class_mm", "price_per_bend", "setup_per_part_type", "placeholder"],
  rate_roll: ["thickness_mm", "radius_class_mm", "price_per_m", "setup", "placeholder"],
  rate_weld: ["process", "bead_mm", "price_per_mm", "setup", "min_order", "placeholder"],
  rate_thread: ["size", "price_each", "placeholder"],
  rate_feature: ["code", "name", "price_each", "placeholder"],
  rate_finish: ["code", "name", "unit", "price", "minimum", "placeholder", "setup_per_order_eur", "min_part_mm"],
  rate_leadtime: ["working_days", "multiplier", "placeholder"],
};
const GENERAL_COLUMNS = [
  "machine_rate_eur_h", "labour_rate_eur_h", "machining_rate_eur_h", "default_margin_pct", "margin_by_class", "blank_margin_mm",
  "slow_contour_factor", "default_stitch_bead_mm", "default_stitch_pitch_mm", "handling_mass_limit_kg", "handling_surcharge_eur",
  "weld_handling_per_part", "placeholder", "order_charge_eur", "packaging_box_eur", "packaging_pallet_eur", "pricing_mode",
];
const ROW_KEYS = { rate_laser: "laser", rate_tube_laser: "tubeLaser", rate_bend: "bend", rate_roll: "roll", rate_weld: "weld", rate_thread: "thread", rate_feature: "feature", rate_finish: "finish", rate_leadtime: "leadtime", materials: "materials" };

function insertStatement(table, rows) {
  const cols = TABLE_COLUMNS[table];
  if (rows.length === 0) return `  -- ${table}: no rows`;
  const values = rows.map((row) => `    (v_new, ${cols.map((c) => lit(row[c] === undefined ? null : row[c])).join(", ")})`).join(",\n");
  return `  insert into public.${table} (rate_version_id, ${cols.join(", ")}) values\n${values};`;
}

/**
 * One idempotent DO block (see file header). `meta` = { file, sha256, sourceLabel, sourceId }.
 */
export function renderSql(build, meta) {
  const { label, rows, report } = build;
  const stamp = new Date().toISOString();
  const note = `Market rates — selling prices (247TailorSteel × 1.10). Loaded by scripts/seed-market-rates.mjs from ${meta.file} (sha256 ${meta.sha256}) on ${stamp}; copied from ${meta.sourceLabel ?? meta.sourceId ?? "the source version"}.`;
  const counts = Object.fromEntries(Object.entries(ROW_KEYS).map(([table, key]) => [table, rows[key].length]));
  const audit = {
    file: meta.file,
    sha256: meta.sha256,
    source_version: meta.sourceId ?? null,
    label,
    counts: { rate_general: 1, ...counts },
    mapped: report.mapped,
    unmapped: report.unmapped,
    warnings: report.warnings,
    script: "scripts/seed-market-rates.mjs",
  };
  const tables = Object.keys(ROW_KEYS);
  const deletes = ["rate_laser", ...tables.filter((t) => t !== "rate_laser"), "rate_general"]
    .map((t) => `  delete from public.${t} where rate_version_id = v_new;`)
    .join("\n");
  const inserts = [
    `  insert into public.rate_general (rate_version_id, ${GENERAL_COLUMNS.join(", ")}) values\n    (v_new, ${GENERAL_COLUMNS.map((c) => lit(rows.general[c] === undefined ? null : rows.general[c])).join(", ")});`,
    insertStatement("materials", rows.materials),
    ...tables.filter((t) => t !== "materials").map((t) => insertStatement(t, rows[ROW_KEYS[t]])),
  ].join("\n");
  return `-- Generated by scripts/seed-market-rates.mjs from ${meta.file} (sha256 ${meta.sha256}) — do not edit; re-run the script.
do $seed$
declare
  v_new uuid;
  v_label constant text := ${lit(label)};
  v_fingerprint constant text := ${lit(`sha256 ${meta.sha256}`)};
  v_note constant text := ${lit(note)};
  v_source uuid := ${meta.sourceId ? lit(meta.sourceId) : "null"};
begin
  select id into v_new from public.rate_versions where label = v_label;
  if v_new is null then
    insert into public.rate_versions (label, note, created_by, active) values (v_label, v_note, null, false) returning id into v_new;
    raise notice 'seed-market-rates: created version % (%)', v_new, v_label;
  end if;

  if exists (select 1 from public.quotes where rate_version_id = v_new or cost_rate_version_id = v_new) then
    if (select coalesce(note, '') from public.rate_versions where id = v_new) like '%' || v_fingerprint || '%' then
      raise notice 'seed-market-rates: version % is used by quotes and already carries this workbook (%): nothing to do', v_new, v_fingerprint;
      return;
    end if;
    raise exception 'seed-market-rates: version % (%) is used by quotes and the workbook changed — load the workbook into a new version name instead', v_new, v_label;
  end if;

${deletes}

${inserts}

  update public.rate_versions set note = v_note where id = v_new;

  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (null, 'rate_version.seed', 'rate_versions', v_new::text, jsonb_build_object('source_version', v_source), ${lit(audit)});
  raise notice 'seed-market-rates: version % (%) loaded — % materials, % laser rows, % finish rows, % lead-time rows', v_new, v_label, ${rows.materials.length}, ${rows.laser.length}, ${rows.finish.length}, ${rows.leadtime.length};
end $seed$;
`;
}

/* ─── source rows (Supabase) ──────────────────────────────── */

async function fetchSourceRows(versionId) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("--source-json not given and NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (path) => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };
  let id = versionId;
  if (!id) {
    const placeholder = await get(`rate_versions?id=eq.${PLACEHOLDER_VERSION_ID}&select=id`);
    if (placeholder.length) id = PLACEHOLDER_VERSION_ID;
    else {
      const active = await get("rate_versions?active=eq.true&select=id");
      if (!active.length) throw new Error("no source version: pass --source-version");
      id = active[0].id;
    }
  }
  const byVersion = (table, order) => get(`${table}?rate_version_id=eq.${id}&select=*${order ? `&order=${order}` : ""}`);
  const [version, generals, materials, laser, tubeLaser, bend, roll, weld, thread, feature, finish, leadtime] = await Promise.all([
    get(`rate_versions?id=eq.${id}&select=*`),
    byVersion("rate_general"),
    byVersion("materials", "code"),
    byVersion("rate_laser", "material_code,thickness_mm"),
    byVersion("rate_tube_laser"),
    byVersion("rate_bend"),
    byVersion("rate_roll"),
    byVersion("rate_weld"),
    byVersion("rate_thread"),
    byVersion("rate_feature"),
    byVersion("rate_finish"),
    byVersion("rate_leadtime"),
  ]);
  if (!version.length || !generals.length) throw new Error(`source version ${id} not found or without rate_general`);
  return { version: version[0], general: generals[0], materials, laser, tubeLaser, bend, roll, weld, thread, feature, finish, leadtime };
}

/* ─── CLI ─────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (name === "apply" || name === "dry-run") args[name] = true;
      else args[name] = argv[(i += 1)];
    } else args._.push(a);
  }
  return args;
}

function printReport(build) {
  const { report } = build;
  console.log(`Rate version: ${build.label}`);
  console.log("Mapped:");
  for (const line of report.mapped) console.log(`  + ${line}`);
  if (report.warnings.length) {
    console.log("Warnings:");
    for (const line of report.warnings) console.log(`  ! ${line}`);
  }
  console.log(report.unmapped.length ? "Not mapped (review):" : "Not mapped: nothing");
  for (const line of report.unmapped) console.log(`  - ${line}`);
}

export async function main(argv) {
  const args = parseArgs(argv);
  const file = args._[0];
  if (!file) {
    console.error("usage: node scripts/seed-market-rates.mjs <workbook.xlsx> [--source-json f] [--source-version uuid] [--sql out.sql] [--apply] [--export-json f] [--dry-run]");
    return 2;
  }
  const bytes = readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const workbook = readWorkbook(bytes);
  const source = args["source-json"] ? JSON.parse(readFileSync(args["source-json"], "utf8")) : await fetchSourceRows(args["source-version"]);
  const build = buildMarketVersion(workbook, source);
  printReport(build);
  if (args["dry-run"]) return 0;

  const meta = { file: basename(file), sha256, sourceId: source.version?.id ?? args["source-version"] ?? null, sourceLabel: source.version?.label ?? null };
  const sql = renderSql(build, meta);
  if (args["export-json"]) {
    writeFileSync(args["export-json"], JSON.stringify({ version: { id: null, label: build.label, note: `sha256 ${sha256}`, active: false }, ...build.rows, machines: source.machines ?? [] }, null, 2) + "\n");
    console.log(`Rows exported to ${args["export-json"]}`);
  }
  if (args.sql) {
    writeFileSync(args.sql, sql);
    console.log(`SQL written to ${args.sql}`);
  }
  if (args.apply) {
    const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("--apply needs SUPABASE_DB_URL (or DATABASE_URL) — the Postgres connection string from Supabase → Database settings");
    const dir = mkdtempSync(join(tmpdir(), "seed-market-"));
    const path = join(dir, "seed.sql");
    writeFileSync(path, sql);
    const result = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-1", "-f", path], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`psql exited with ${result.status}`);
    console.log("Applied.");
  } else if (!args.sql && !args["export-json"]) {
    process.stdout.write(sql);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  );
}
