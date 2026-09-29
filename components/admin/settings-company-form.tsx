"use client";

/**
 * CompanySettingsForm — the single company_settings row as a sectioned
 * .field form: identity, address, contact, registers, bank, and the
 * pricing switches (OSS active, assembly and subcontract margins).
 * File path: /components/admin/settings-company-form.tsx
 *
 * Controlled state seeded from the server row (the page keys the form by
 * updated_at, so a save → revalidate → fresh row remounts it). Fields
 * still carrying a placeholder marker (000-000 / PL00 / XXXX / [CONFIRM])
 * are marked invalid with the amber chip next to the section title, since
 * those values block the PDF export (lib/quotes/send-guard.ts). Numbers
 * are edited as text and parsed by the action.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";
import { useToast } from "@/components/ui/toast";
import { formatNumberInput } from "@/lib/number-input";
import { ALL_COUNTRY_CODES, countryName, sortCountryCodesByName } from "@/lib/customers/countries";
import type { CompanySettingsRow } from "@/lib/db/types";
import {
  COMPANY_SETTINGS_PLACEHOLDER_MARKERS,
  type CompanySettingsInput,
  type CompanyTextField,
  type SettingsActionResult,
} from "@/lib/admin/settings-types";
import { saveCompanySettings } from "@/lib/admin/settings-actions";
import { settingsErrorText } from "@/components/admin/settings-table";

type Section = { key: keyof ReturnType<typeof useContent>["admin"]["settings"]["company"]["sections"]; fields: CompanyTextField[] };

const SECTIONS: Section[] = [
  { key: "identity", fields: ["brand", "legal_name"] },
  { key: "address", fields: ["street", "postal_code", "city", "country"] },
  { key: "contact", fields: ["phone", "email", "website"] },
  { key: "registry", fields: ["nip", "regon", "krs"] },
  { key: "bank", fields: ["bank_name", "iban_pln", "iban_eur", "swift"] },
];

function hasMarker(value: string): boolean {
  return COMPANY_SETTINGS_PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

function initialValues(row: CompanySettingsRow | null, locale: "pl" | "en"): CompanySettingsInput {
  const text = (field: CompanyTextField) => (row ? String(row[field] ?? "") : field === "country" ? "PL" : "");
  return {
    brand: text("brand"),
    legal_name: text("legal_name"),
    street: text("street"),
    postal_code: text("postal_code"),
    city: text("city"),
    country: text("country") || "PL",
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    nip: text("nip"),
    regon: text("regon"),
    krs: text("krs"),
    bank_name: text("bank_name"),
    iban_pln: text("iban_pln"),
    iban_eur: text("iban_eur"),
    swift: text("swift"),
    oss_active: row?.oss_active ?? false,
    assembly_margin_pct: formatNumberInput(row?.assembly_margin_pct ?? 30, locale, { maxDecimals: 2, grouping: false }),
    subcontract_margin_pct: formatNumberInput(row?.subcontract_margin_pct ?? 15, locale, { maxDecimals: 2, grouping: false }),
  };
}

export function CompanySettingsForm({ row }: { row: CompanySettingsRow | null }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.admin.settings;
  const f = t.company.fields;
  const { toast } = useToast();
  const [values, setValues] = useState<CompanySettingsInput>(() => initialValues(row, locale));
  const [failure, setFailure] = useState<Extract<SettingsActionResult, { ok: false }> | null>(null);
  const [pending, startTransition] = useTransition();
  const countries = sortCountryCodesByName(ALL_COUNTRY_CODES, locale, c.quote.customers.countries as Readonly<Record<string, string>>);

  const set = <K extends keyof CompanySettingsInput>(key: K, value: CompanySettingsInput[K]) => setValues((prev) => ({ ...prev, [key]: value }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCompanySettings(values);
      if (result.ok) {
        setFailure(null);
        toast(t.notices.saved, { tone: "success" });
      } else {
        setFailure(result);
        toast(t.errors[result.error], { tone: "error" });
      }
    });
  };

  const invalid = (field: string) => failure?.field === field;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {failure && <Notice tone="error">{settingsErrorText(failure, t.errors, t.fieldPrefix, f)}</Notice>}
      {SECTIONS.map((section) => {
        const placeholders = section.fields.filter((field) => hasMarker(values[field]));
        return (
          <fieldset key={section.key} className="flex flex-col gap-3">
            <legend className="mb-2 flex items-center gap-3">
              <span className="h2-sm">{t.company.sections[section.key]}</span>
              {placeholders.length > 0 && <StatusChip severity="amber" plain label={t.placeholderChip} />}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {section.fields.map((field) => {
                const id = `company-${field}`;
                if (field === "country") {
                  return (
                    <Field key={field} label={f.country} htmlFor={id}>
                      <Select id={id} value={values.country} onChange={(event) => set("country", event.target.value)} disabled={pending} invalid={invalid(field)} dense>
                        {countries.map((code) => (
                          <option key={code} value={code}>
                            {code} — {countryName(code, locale, c.quote.customers.countries as Readonly<Record<string, string>>)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  );
                }
                return (
                  <Field key={field} label={f[field]} htmlFor={id} className={field === "legal_name" || field === "street" ? "sm:col-span-2" : undefined}>
                    <Input
                      id={id}
                      value={values[field]}
                      onChange={(event) => set(field, event.target.value)}
                      disabled={pending}
                      invalid={invalid(field) || hasMarker(values[field])}
                      maxLength={200}
                      dense
                      type={field === "email" ? "email" : "text"}
                    />
                  </Field>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2">
          <span className="h2-sm">{t.company.sections.pricing}</span>
        </legend>
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            className="checkbox"
            checked={Boolean(values.oss_active)}
            onChange={(event) => set("oss_active", event.target.checked)}
            disabled={pending}
          />
          {f.oss_active}
        </label>
        <p className="text-[13px] text-text-muted">{t.company.ossHelp}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={f.assembly_margin_pct} htmlFor="company-assembly_margin_pct">
            <Input
              id="company-assembly_margin_pct"
              value={String(values.assembly_margin_pct)}
              onChange={(event) => set("assembly_margin_pct", event.target.value)}
              inputMode="decimal"
              disabled={pending}
              invalid={invalid("assembly_margin_pct")}
              num
              dense
            />
          </Field>
          <Field label={f.subcontract_margin_pct} htmlFor="company-subcontract_margin_pct">
            <Input
              id="company-subcontract_margin_pct"
              value={String(values.subcontract_margin_pct)}
              onChange={(event) => set("subcontract_margin_pct", event.target.value)}
              inputMode="decimal"
              disabled={pending}
              invalid={invalid("subcontract_margin_pct")}
              num
              dense
            />
          </Field>
        </div>
        <p className="text-[13px] text-text-muted">{t.company.marginsHelp}</p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? c.common.actions.saving : t.actions.save}
          <span aria-hidden="true" className="btn-arrow">
            →
          </span>
        </button>
      </div>
    </form>
  );
}
