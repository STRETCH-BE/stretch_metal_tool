/**
 * Rate-table registry — the ONE description of the ten versioned rate
 * tables that the admin editor, the CSV import/export, the diff view and
 * the row validation all read from.
 * File path: /lib/admin/tables.ts
 *
 * Pure (no Next, no Supabase). For each table: the DB table name, whether
 * rows carry a uuid `id` (rate_general and materials do not — they are
 * keyed by version [+ code]), the natural key columns and every editable
 * column with its kind (number / text / select / bool / json). The zod
 * row schema validates the editable columns only — `rate_version_id`,
 * `id` and `placeholder` are set by the server. Numbers accept numeric
 * strings ("1,5" or "1.5", the CSV path) through lib/number-input.
 *
 * Validation messages are CODES (keys of content.admin.rates.errors):
 * required · invalidNumber · negative · invalidOption · invalidJson ·
 * tooLong · invalid — never copy.
 */

import { z } from "zod";
import { marginByClassSchema, priceBandsSchema, sheetFormatsSchema } from "@/lib/pricing/snapshot";
import { parseNumberInput } from "@/lib/number-input";

export const RATE_TABLE_NAMES = [
  "general",
  "materials",
  "laser",
  "tube_laser",
  "bend",
  "roll",
  "weld",
  "thread",
  "feature",
  "finish",
] as const;

export type RateTableName = (typeof RATE_TABLE_NAMES)[number];

export type RateDbTable =
  | "rate_general"
  | "materials"
  | "rate_laser"
  | "rate_tube_laser"
  | "rate_bend"
  | "rate_roll"
  | "rate_weld"
  | "rate_thread"
  | "rate_feature"
  | "rate_finish";

export type ColumnKind = "number" | "text" | "select" | "bool" | "json";
export type JsonKind = "priceBands" | "sheetFormats" | "marginByClass";
export type OptionGroup = "mode" | "gas" | "process" | "unit" | "family" | "profileFamily";

export type ColumnDef = {
  name: string;
  kind: ColumnKind;
  /** Part of the natural key (shown first; identifies the row in diff/CSV). */
  key?: boolean;
  /** number/text/select may be empty → null. */
  nullable?: boolean;
  /** Select options (also the enum the schema accepts). */
  options?: readonly string[];
  /** Content group for option labels (content.admin.rates.options[group]). */
  optionGroup?: OptionGroup;
  /** Display precision for numbers. */
  decimals?: number;
  /** Lower bound (default 0). */
  min?: number;
  jsonKind?: JsonKind;
  maxLength?: number;
};

export type RateTableDef = {
  name: RateTableName;
  dbTable: RateDbTable;
  /** Exactly one row per version (rate_general). */
  singleRow: boolean;
  /** Rows have a uuid `id` column. */
  hasId: boolean;
  keyColumns: readonly string[];
  columns: readonly ColumnDef[];
  schema: z.ZodType<Record<string, unknown>, unknown>;
};

export const MATERIAL_FAMILIES = ["mild_steel", "stainless", "aluminium", "brass", "copper"] as const;
export const LASER_MODES = ["time", "per_m"] as const;
export const LASER_GASES = ["O2", "N2", "air"] as const;
export const TUBE_PROFILE_FAMILIES = ["round", "square", "rectangular", "open"] as const;
export const WELD_PROCESSES = ["mig_mag", "tig", "laser", "mma"] as const;
export const FINISH_UNITS = ["m2", "kg", "m", "each"] as const;

/* ─── Field schemas (messages are codes) ─────────────────── */

function toNumberInput(value: unknown): unknown {
  if (value === "" || value === undefined) return null;
  if (typeof value === "string") {
    const parsed = parseNumberInput(value);
    return parsed === null ? value : parsed;
  }
  return value;
}

function numberField(options: { nullable?: boolean; min?: number } = {}) {
  const min = options.min ?? 0;
  const base = z
    .number({
      error: (issue) => (issue.input === null || issue.input === undefined ? "required" : "invalidNumber"),
    })
    .refine((n) => Number.isFinite(n), "invalidNumber")
    .refine((n) => n >= min, "negative");
  return z.preprocess(toNumberInput, options.nullable ? base.nullable() : base);
}

function textField(options: { nullable?: boolean; max?: number } = {}) {
  const max = options.max ?? 120;
  if (options.nullable) {
    return z.preprocess(
      (v) => (v === null || v === undefined ? "" : v),
      z
        .string({ error: "invalid" })
        .trim()
        .max(max, "tooLong")
        .transform((v) => (v === "" ? null : v))
    );
  }
  return z.preprocess(
    (v) => (v === null || v === undefined ? "" : v),
    z.string({ error: "invalid" }).trim().min(1, "required").max(max, "tooLong")
  );
}

function selectField(options: readonly string[], nullable = false) {
  const base = z.enum(options as [string, ...string[]], "invalidOption");
  if (!nullable) return z.preprocess((v) => (typeof v === "string" ? v.trim() : v), base);
  return z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? v.trim() : v),
    base.nullable()
  );
}

const TRUE_WORDS = new Set(["true", "1", "yes", "y", "tak", "t", "x"]);
const FALSE_WORDS = new Set(["false", "0", "no", "n", "nie", "f", ""]);

function boolField() {
  return z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const word = v.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return true;
      if (FALSE_WORDS.has(word)) return false;
    }
    if (v === null || v === undefined) return false;
    return v;
  }, z.boolean({ error: "invalidOption" }));
}

function jsonField<T>(schema: z.ZodType<T>) {
  return z.preprocess((v) => {
    if (typeof v === "string") {
      const text = v.trim();
      if (text === "") return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return v;
      }
    }
    return v;
  }, schema);
}

/* ─── Column lists ────────────────────────────────────────── */

const GENERAL_COLUMNS: readonly ColumnDef[] = [
  { name: "machine_rate_eur_h", kind: "number", decimals: 2 },
  { name: "labour_rate_eur_h", kind: "number", decimals: 2 },
  { name: "machining_rate_eur_h", kind: "number", decimals: 2 },
  { name: "default_margin_pct", kind: "number", decimals: 2 },
  { name: "margin_by_class", kind: "json", jsonKind: "marginByClass" },
  { name: "blank_margin_mm", kind: "number", decimals: 2 },
  { name: "slow_contour_factor", kind: "number", decimals: 3 },
  { name: "default_stitch_bead_mm", kind: "number", decimals: 2 },
  { name: "default_stitch_pitch_mm", kind: "number", decimals: 2 },
  { name: "handling_mass_limit_kg", kind: "number", decimals: 2 },
  { name: "handling_surcharge_eur", kind: "number", decimals: 2 },
  { name: "weld_handling_per_part", kind: "number", decimals: 2 },
];

const MATERIAL_COLUMNS: readonly ColumnDef[] = [
  { name: "code", kind: "text", key: true, maxLength: 40 },
  { name: "name", kind: "text", maxLength: 120 },
  { name: "family", kind: "select", options: MATERIAL_FAMILIES, optionGroup: "family" },
  { name: "density_kg_m3", kind: "number", decimals: 0 },
  { name: "rm_n_mm2", kind: "number", decimals: 0 },
  { name: "price_per_kg", kind: "json", jsonKind: "priceBands" },
  { name: "sheet_formats", kind: "json", jsonKind: "sheetFormats" },
  { name: "scrap_pct_default", kind: "number", decimals: 2 },
];

const LASER_COLUMNS: readonly ColumnDef[] = [
  { name: "material_code", kind: "text", key: true, maxLength: 40 },
  { name: "thickness_mm", kind: "number", key: true, decimals: 3 },
  { name: "in_house", kind: "bool", key: true },
  { name: "mode", kind: "select", options: LASER_MODES, optionGroup: "mode" },
  { name: "speed_m_min", kind: "number", nullable: true, decimals: 3 },
  { name: "pierce_s", kind: "number", nullable: true, decimals: 3 },
  { name: "price_per_m", kind: "number", nullable: true, decimals: 4 },
  { name: "price_per_pierce", kind: "number", decimals: 4 },
  { name: "gas", kind: "select", nullable: true, options: LASER_GASES, optionGroup: "gas" },
  { name: "min_contour_mm", kind: "number", nullable: true, decimals: 2 },
  { name: "supplier", kind: "text", nullable: true, maxLength: 120 },
];

const TUBE_LASER_COLUMNS: readonly ColumnDef[] = [
  { name: "profile_family", kind: "select", key: true, options: TUBE_PROFILE_FAMILIES, optionGroup: "profileFamily" },
  { name: "wall_mm", kind: "number", key: true, decimals: 3 },
  { name: "price_per_m_cut", kind: "number", decimals: 4 },
  { name: "handling_per_part", kind: "number", decimals: 4 },
  { name: "setup", kind: "number", decimals: 4 },
];

const BEND_COLUMNS: readonly ColumnDef[] = [
  { name: "thickness_mm", kind: "number", key: true, decimals: 3 },
  { name: "length_class_mm", kind: "number", key: true, decimals: 2 },
  { name: "price_per_bend", kind: "number", decimals: 4 },
  { name: "setup_per_part_type", kind: "number", decimals: 4 },
];

const ROLL_COLUMNS: readonly ColumnDef[] = [
  { name: "thickness_mm", kind: "number", key: true, decimals: 3 },
  { name: "radius_class_mm", kind: "number", key: true, decimals: 2 },
  { name: "price_per_m", kind: "number", decimals: 4 },
  { name: "setup", kind: "number", decimals: 4 },
];

const WELD_COLUMNS: readonly ColumnDef[] = [
  { name: "process", kind: "select", key: true, options: WELD_PROCESSES, optionGroup: "process" },
  { name: "bead_mm", kind: "number", key: true, decimals: 2 },
  { name: "price_per_mm", kind: "number", decimals: 6 },
  { name: "setup", kind: "number", decimals: 4 },
  { name: "min_order", kind: "number", decimals: 4 },
];

const THREAD_COLUMNS: readonly ColumnDef[] = [
  { name: "size", kind: "text", key: true, maxLength: 20 },
  { name: "price_each", kind: "number", decimals: 4 },
];

const FEATURE_COLUMNS: readonly ColumnDef[] = [
  { name: "code", kind: "text", key: true, maxLength: 40 },
  { name: "name", kind: "text", maxLength: 120 },
  { name: "price_each", kind: "number", decimals: 4 },
];

const FINISH_COLUMNS: readonly ColumnDef[] = [
  { name: "code", kind: "text", key: true, maxLength: 40 },
  { name: "name", kind: "text", maxLength: 120 },
  { name: "unit", kind: "select", options: FINISH_UNITS, optionGroup: "unit" },
  { name: "price", kind: "number", decimals: 4 },
  { name: "minimum", kind: "number", decimals: 4 },
];

/* ─── Row schemas ─────────────────────────────────────────── */

function rowSchema(shape: z.ZodRawShape): z.ZodType<Record<string, unknown>, unknown> {
  return z.object(shape) as unknown as z.ZodType<Record<string, unknown>, unknown>;
}

const generalSchema = rowSchema({
  machine_rate_eur_h: numberField(),
  labour_rate_eur_h: numberField(),
  machining_rate_eur_h: numberField(),
  default_margin_pct: numberField(),
  margin_by_class: jsonField(marginByClassSchema),
  blank_margin_mm: numberField(),
  slow_contour_factor: numberField(),
  default_stitch_bead_mm: numberField(),
  default_stitch_pitch_mm: numberField(),
  handling_mass_limit_kg: numberField(),
  handling_surcharge_eur: numberField(),
  weld_handling_per_part: numberField(),
});

const materialSchema = rowSchema({
  code: textField({ max: 40 }),
  name: textField({ max: 120 }),
  family: selectField(MATERIAL_FAMILIES),
  density_kg_m3: numberField(),
  rm_n_mm2: numberField(),
  price_per_kg: jsonField(priceBandsSchema),
  sheet_formats: jsonField(sheetFormatsSchema),
  scrap_pct_default: numberField(),
});

const laserSchema = rowSchema({
  material_code: textField({ max: 40 }),
  thickness_mm: numberField(),
  in_house: boolField(),
  mode: selectField(LASER_MODES),
  speed_m_min: numberField({ nullable: true }),
  pierce_s: numberField({ nullable: true }),
  price_per_m: numberField({ nullable: true }),
  price_per_pierce: numberField(),
  gas: selectField(LASER_GASES, true),
  min_contour_mm: numberField({ nullable: true }),
  supplier: textField({ nullable: true, max: 120 }),
});

const tubeLaserSchema = rowSchema({
  profile_family: selectField(TUBE_PROFILE_FAMILIES),
  wall_mm: numberField(),
  price_per_m_cut: numberField(),
  handling_per_part: numberField(),
  setup: numberField(),
});

const bendSchema = rowSchema({
  thickness_mm: numberField(),
  length_class_mm: numberField(),
  price_per_bend: numberField(),
  setup_per_part_type: numberField(),
});

const rollSchema = rowSchema({
  thickness_mm: numberField(),
  radius_class_mm: numberField(),
  price_per_m: numberField(),
  setup: numberField(),
});

const weldSchema = rowSchema({
  process: selectField(WELD_PROCESSES),
  bead_mm: numberField(),
  price_per_mm: numberField(),
  setup: numberField(),
  min_order: numberField(),
});

const threadSchema = rowSchema({
  size: textField({ max: 20 }),
  price_each: numberField(),
});

const featureSchema = rowSchema({
  code: textField({ max: 40 }),
  name: textField({ max: 120 }),
  price_each: numberField(),
});

const finishSchema = rowSchema({
  code: textField({ max: 40 }),
  name: textField({ max: 120 }),
  unit: selectField(FINISH_UNITS),
  price: numberField(),
  minimum: numberField(),
});

/* ─── Registry ────────────────────────────────────────────── */

function def(
  name: RateTableName,
  dbTable: RateDbTable,
  columns: readonly ColumnDef[],
  schema: z.ZodType<Record<string, unknown>, unknown>,
  options: { singleRow?: boolean; hasId?: boolean } = {}
): RateTableDef {
  return {
    name,
    dbTable,
    singleRow: options.singleRow ?? false,
    hasId: options.hasId ?? true,
    keyColumns: columns.filter((c) => c.key).map((c) => c.name),
    columns,
    schema,
  };
}

export const RATE_TABLES: Record<RateTableName, RateTableDef> = {
  general: def("general", "rate_general", GENERAL_COLUMNS, generalSchema, { singleRow: true, hasId: false }),
  materials: def("materials", "materials", MATERIAL_COLUMNS, materialSchema, { hasId: false }),
  laser: def("laser", "rate_laser", LASER_COLUMNS, laserSchema),
  tube_laser: def("tube_laser", "rate_tube_laser", TUBE_LASER_COLUMNS, tubeLaserSchema),
  bend: def("bend", "rate_bend", BEND_COLUMNS, bendSchema),
  roll: def("roll", "rate_roll", ROLL_COLUMNS, rollSchema),
  weld: def("weld", "rate_weld", WELD_COLUMNS, weldSchema),
  thread: def("thread", "rate_thread", THREAD_COLUMNS, threadSchema),
  feature: def("feature", "rate_feature", FEATURE_COLUMNS, featureSchema),
  finish: def("finish", "rate_finish", FINISH_COLUMNS, finishSchema),
};

export function isRateTableName(value: unknown): value is RateTableName {
  return typeof value === "string" && (RATE_TABLE_NAMES as readonly string[]).includes(value);
}

/* ─── Validation ──────────────────────────────────────────── */

export type RowFieldErrors = Record<string, string>;

export type ValidatedRow =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; fieldErrors: RowFieldErrors };

const KNOWN_CODES = new Set(["required", "invalidNumber", "negative", "invalidOption", "invalidJson", "tooLong", "invalid"]);

/**
 * Validate the editable columns of one row. Unknown keys are dropped
 * (`id`, `rate_version_id`, `placeholder`, CSV extras). Field errors are
 * codes keyed by column; nested JSON issues collapse to "invalidJson".
 */
export function validateRateRow(table: RateTableName, input: Record<string, unknown>): ValidatedRow {
  const table_ = RATE_TABLES[table];
  const picked: Record<string, unknown> = {};
  for (const column of table_.columns) picked[column.name] = input[column.name];
  const result = table_.schema.safeParse(picked);
  if (result.success) return { ok: true, values: result.data };

  const fieldErrors: RowFieldErrors = {};
  for (const issue of result.error.issues) {
    const column = typeof issue.path[0] === "string" ? issue.path[0] : "(root)";
    if (column in fieldErrors) continue;
    const columnDef = table_.columns.find((c) => c.name === column);
    if (columnDef?.kind === "json") {
      fieldErrors[column] = "invalidJson";
      continue;
    }
    fieldErrors[column] = KNOWN_CODES.has(issue.message) ? issue.message : "invalid";
  }
  return { ok: false, fieldErrors };
}

/* ─── Natural keys ────────────────────────────────────────── */

/** Canonical text for one key cell: numbers by value, booleans as 1/0. */
export function keyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && /^[-+]?\d+(\.\d+)?$/.test(trimmed)) return String(Number(trimmed));
    return trimmed;
  }
  return JSON.stringify(value);
}

/** Natural key of a row ("general" for the single-row table). */
export function rateRowKey(table: RateTableName, row: Record<string, unknown>): string {
  const table_ = RATE_TABLES[table];
  if (table_.singleRow) return "general";
  return table_.keyColumns.map((column) => keyCell(row[column])).join("|");
}

/** Blank values for a new grid row (null numbers, "" text, first option, false). */
export function blankRateRow(table: RateTableName): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of RATE_TABLES[table].columns) {
    switch (column.kind) {
      case "number":
        values[column.name] = null;
        break;
      case "text":
        values[column.name] = "";
        break;
      case "select":
        values[column.name] = column.nullable ? null : (column.options?.[0] ?? "");
        break;
      case "bool":
        values[column.name] = column.name === "in_house";
        break;
      case "json":
        values[column.name] = column.jsonKind === "marginByClass" ? {} : [];
        break;
    }
  }
  return values;
}

/** CSV column order: key columns first (as declared), then the rest, then placeholder. */
export function csvColumns(table: RateTableName): string[] {
  return [...RATE_TABLES[table].columns.map((c) => c.name), "placeholder"];
}
