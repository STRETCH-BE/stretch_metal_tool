"use client";

/**
 * The five row-based settings tables — VAT rates, packaging, shipping
 * bands, job setups, weld speeds — as thin wrappers over SettingsTable:
 * each declares its columns (labels from content.admin.settings), turns
 * the DB rows into editable text values and maps a saved row back onto
 * the typed server action of lib/admin/settings-actions.ts.
 * File path: /components/admin/settings-row-tables.tsx
 *
 * Country columns are a select over every ISO 3166-1 alpha-2 code sorted
 * by localized name (lib/customers/countries.ts, names overridden by the
 * curated list in content.quote.customers.countries). Weld processes and
 * setup codes are the DB enums; their labels come from the existing rate
 * option / setup code dictionaries. Job setups have no add row and no
 * delete: the four codes are fixed by the migration's check constraint.
 */

import { useMemo } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { formatNumberInput } from "@/lib/number-input";
import { ALL_COUNTRY_CODES, countryName, sortCountryCodesByName } from "@/lib/customers/countries";
import type { JobSetupRateRow, PackagingRateRow, ShippingRateRow, VatRateRow, WeldSpeedRow } from "@/lib/db/types";
import { JOB_SETUP_CODES, WELD_SPEED_PROCESSES } from "@/lib/admin/settings-types";
import {
  deletePackagingRate,
  deleteShippingRate,
  deleteVatRate,
  deleteWeldSpeed,
  saveJobSetupRate,
  upsertPackagingRate,
  upsertShippingRate,
  upsertVatRate,
  upsertWeldSpeed,
} from "@/lib/admin/settings-actions";
import { SettingsTable, type SettingsColumn, type SettingsEditableRow } from "@/components/admin/settings-table";

function useNumberText() {
  const locale = useLocale();
  return (value: number | null | undefined) => formatNumberInput(value, locale, { maxDecimals: 4, grouping: false });
}

function useCountryOptions() {
  const c = useContent();
  const locale = useLocale();
  return useMemo(() => {
    const overrides = c.quote.customers.countries as Readonly<Record<string, string>>;
    return sortCountryCodesByName(ALL_COUNTRY_CODES, locale, overrides).map((code) => ({
      value: code,
      label: `${code} — ${countryName(code, locale, overrides)}`,
    }));
  }, [c, locale]);
}

/* ─── VAT rates ──────────────────────────────────────────── */

export function VatRatesTable({ rows }: { rows: VatRateRow[] }) {
  const c = useContent();
  const t = c.admin.settings.vat;
  const n = useNumberText();
  const countries = useCountryOptions();
  const columns: SettingsColumn[] = [
    { name: "country", label: t.columns.country, kind: "select", options: countries, keyField: true, width: "lg" },
    { name: "rate_pct", label: t.columns.rate, kind: "number", required: true, width: "sm" },
  ];
  const editable: SettingsEditableRow[] = rows.map((row) => ({
    key: row.country,
    values: { country: row.country, rate_pct: n(row.rate_pct) },
    placeholder: null,
    updatedAt: row.updated_at,
  }));
  return (
    <SettingsTable
      columns={columns}
      rows={editable}
      blank={{ country: "PL", rate_pct: "" }}
      placeholderColumn={false}
      emptyText={c.common.empty.generic}
      save={(values) => upsertVatRate({ country: values.country, rate_pct: values.rate_pct })}
      remove={(values) => deleteVatRate(values.country)}
    />
  );
}

/* ─── Packaging rates ────────────────────────────────────── */

export function PackagingRatesTable({ rows }: { rows: PackagingRateRow[] }) {
  const c = useContent();
  const t = c.admin.settings.packaging;
  const n = useNumberText();
  const columns: SettingsColumn[] = [
    { name: "code", label: t.columns.code, kind: "text", keyField: true, required: true, maxLength: 40, width: "sm" },
    { name: "name", label: t.columns.name, kind: "text", required: true, maxLength: 120, width: "md" },
    { name: "max_side_mm", label: t.columns.maxSide, kind: "number", required: true, width: "sm" },
    { name: "max_mass_kg", label: t.columns.maxMass, kind: "number", required: true, width: "sm" },
    { name: "price_eur", label: t.columns.price, kind: "number", required: true, width: "sm" },
    { name: "position", label: t.columns.position, kind: "number", width: "xs" },
  ];
  const editable: SettingsEditableRow[] = rows.map((row) => ({
    key: row.code,
    values: {
      code: row.code,
      name: row.name,
      max_side_mm: n(row.max_side_mm),
      max_mass_kg: n(row.max_mass_kg),
      price_eur: n(row.price_eur),
      position: n(row.position),
    },
    placeholder: row.placeholder,
    updatedAt: row.updated_at,
  }));
  return (
    <SettingsTable
      columns={columns}
      rows={editable}
      blank={{ code: "", name: "", max_side_mm: "", max_mass_kg: "", price_eur: "", position: String(rows.length + 1) }}
      placeholderColumn
      emptyText={c.common.empty.generic}
      save={(values) =>
        upsertPackagingRate({
          code: values.code,
          name: values.name,
          max_side_mm: values.max_side_mm,
          max_mass_kg: values.max_mass_kg,
          price_eur: values.price_eur,
          position: values.position,
        })
      }
      remove={(values) => deletePackagingRate(values.code)}
    />
  );
}

/* ─── Shipping rates ─────────────────────────────────────── */

export function ShippingRatesTable({ rows }: { rows: ShippingRateRow[] }) {
  const c = useContent();
  const t = c.admin.settings.shipping;
  const n = useNumberText();
  const countries = useCountryOptions();
  const columns: SettingsColumn[] = [
    { name: "country", label: t.columns.country, kind: "select", options: countries, width: "lg" },
    { name: "max_kg", label: t.columns.maxKg, kind: "number", required: true, width: "sm" },
    { name: "price_eur", label: t.columns.price, kind: "number", required: true, width: "sm" },
    { name: "carrier", label: t.columns.carrier, kind: "text", maxLength: 80, width: "sm" },
    { name: "position", label: t.columns.position, kind: "number", width: "xs" },
  ];
  const editable: SettingsEditableRow[] = rows.map((row) => ({
    key: row.id,
    values: {
      id: row.id,
      country: row.country,
      max_kg: n(row.max_kg),
      price_eur: n(row.price_eur),
      carrier: row.carrier ?? "",
      position: n(row.position),
    },
    placeholder: row.placeholder,
    updatedAt: row.updated_at,
  }));
  return (
    <SettingsTable
      columns={columns}
      rows={editable}
      blank={{ id: "", country: "PL", max_kg: "", price_eur: "", carrier: "", position: "" }}
      placeholderColumn
      emptyText={c.common.empty.generic}
      save={(values) =>
        upsertShippingRate({
          id: values.id || null,
          country: values.country,
          max_kg: values.max_kg,
          price_eur: values.price_eur,
          carrier: values.carrier,
          position: values.position,
        })
      }
      remove={(values) => deleteShippingRate(values.id)}
    />
  );
}

/* ─── Job setup rates ────────────────────────────────────── */

export function JobSetupRatesTable({ rows }: { rows: JobSetupRateRow[] }) {
  const c = useContent();
  const t = c.admin.settings.setups;
  const n = useNumberText();
  const codeOptions = JOB_SETUP_CODES.map((code) => ({ value: code, label: t.codes[code] }));
  const columns: SettingsColumn[] = [
    { name: "code", label: t.columns.code, kind: "select", options: codeOptions, keyField: true, width: "lg" },
    { name: "name", label: t.columns.name, kind: "text", required: true, maxLength: 160, width: "lg" },
    { name: "cost_eur", label: t.columns.cost, kind: "number", required: true, width: "sm" },
  ];
  // Every code the constraint allows gets a row; a code the table lacks is shown as an add row with the seeded name.
  const byCode = new Map(rows.map((row) => [row.code, row] as const));
  const editable: SettingsEditableRow[] = JOB_SETUP_CODES.filter((code) => byCode.has(code)).map((code) => {
    const row = byCode.get(code) as JobSetupRateRow;
    return {
      key: row.code,
      values: { code: row.code, name: row.name, cost_eur: n(row.cost_eur) },
      placeholder: row.placeholder,
      updatedAt: row.updated_at,
    };
  });
  const missingCode = JOB_SETUP_CODES.find((code) => !byCode.has(code));
  return (
    <SettingsTable
      columns={columns}
      rows={editable}
      blank={missingCode ? { code: missingCode, name: t.codes[missingCode], cost_eur: "" } : undefined}
      placeholderColumn
      emptyText={c.common.empty.generic}
      save={(values) => saveJobSetupRate({ code: values.code, cost_eur: values.cost_eur, name: values.name })}
    />
  );
}

/* ─── Weld speeds ────────────────────────────────────────── */

export function WeldSpeedsTable({ rows }: { rows: WeldSpeedRow[] }) {
  const c = useContent();
  const t = c.admin.settings.weldSpeeds;
  const n = useNumberText();
  const processOptions = WELD_SPEED_PROCESSES.map((process) => ({ value: process, label: c.admin.rates.options.process[process] }));
  const columns: SettingsColumn[] = [
    { name: "process", label: t.columns.process, kind: "select", options: processOptions, width: "md" },
    { name: "thickness_mm", label: t.columns.thickness, kind: "number", required: true, width: "sm" },
    { name: "speed_mm_min", label: t.columns.speed, kind: "number", required: true, width: "sm" },
  ];
  const editable: SettingsEditableRow[] = rows.map((row) => ({
    key: row.id,
    values: { id: row.id, process: row.process, thickness_mm: n(row.thickness_mm), speed_mm_min: n(row.speed_mm_min) },
    placeholder: row.placeholder,
    updatedAt: row.updated_at,
  }));
  return (
    <SettingsTable
      columns={columns}
      rows={editable}
      blank={{ id: "", process: "mig_mag", thickness_mm: "", speed_mm_min: "" }}
      placeholderColumn
      emptyText={c.common.empty.generic}
      save={(values) =>
        upsertWeldSpeed({ id: values.id || null, process: values.process, thickness_mm: values.thickness_mm, speed_mm_min: values.speed_mm_min })
      }
      remove={(values) => deleteWeldSpeed(values.id)}
    />
  );
}
