"use client";

/**
 * CustomerForm — create / edit form for a customer (name, VAT id, country,
 * address, e-mail, phone, class, preferred locale, notes).
 * File path: /components/customers/customer-form.tsx
 *
 * Driven by useActionState over a server action reducer
 * (createCustomer or updateCustomer.bind(null, id)); field errors come
 * back as codes and are mapped to copy here.
 *
 * React 19 resets a <form action> to its defaultValues once the action
 * settles — also after a validation error — so nothing may rely on the
 * DOM keeping typed input. The actions echo the submitted strings back
 * as `state.values`, and every control takes its defaultValue from
 * `state.values` first, then the saved/loaded row, then "". Country is
 * controlled (state) to drive the default-currency hint (PLN for PL, EUR
 * otherwise — lib/customers/currency.ts) and is re-synced from
 * `state.values` on error for the same reason.
 *
 * Country select: the curated PREFERRED_COUNTRY_CODES (names from
 * content) come first, then every other ISO 3166-1 code labelled via
 * Intl.DisplayNames (lib/customers/countries.ts) — any country is valid,
 * only the default currency depends on it. `readOnly` renders the
 * viewer role's disabled version.
 */

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { FormError } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { interpolate } from "@/components/ui/format";
import { routes } from "@/lib/routes";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";
import {
  ALL_COUNTRY_CODES,
  countryName,
  isCountryCode,
  sortCountryCodesByName,
} from "@/lib/customers/countries";
import {
  PREFERRED_COUNTRY_CODES,
  CUSTOMER_CLASSES,
  DEFAULT_COUNTRY,
  DEFAULT_CUSTOMER_CLASS,
  INITIAL_CUSTOMER_FORM_STATE,
  type CustomerField,
  type CustomerFormState,
} from "@/lib/customers/schema";
import type { CustomerRow } from "@/lib/db/types";

export type CustomerFormProps = {
  mode: "create" | "edit";
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  customer?: CustomerRow | null;
  readOnly?: boolean;
};

const PREFERRED_SET: ReadonlySet<string> = new Set(PREFERRED_COUNTRY_CODES);

export function CustomerForm({ mode, action, customer, readOnly = false }: CustomerFormProps) {
  const c = useContent();
  const t = c.quote.customers;
  const { toast } = useToast();
  const [state, formAction] = useActionState(action, INITIAL_CUSTOMER_FORM_STATE);
  const [country, setCountry] = useState<string>(customer?.country ?? DEFAULT_COUNTRY);
  const lastHandled = useRef<CustomerFormState | null>(null);

  useEffect(() => {
    if (lastHandled.current === state) return;
    lastHandled.current = state;
    if (state.status === "saved") toast(t.form.saved, { tone: "success" });
    if (state.status === "error" && state.values) setCountry(state.values.country);
  }, [state, toast, t.form.saved]);

  const otherCountries = useMemo(
    () =>
      sortCountryCodesByName(
        ALL_COUNTRY_CODES.filter((code) => !PREFERRED_SET.has(code)),
        c.locale
      ),
    [c.locale]
  );

  const fieldError = (field: CustomerField): string | undefined => {
    const code = state.fieldErrors?.[field];
    return code ? t.errors[code] : undefined;
  };
  const formError = state.error ? t.errors[state.error] : null;
  const current = state.customer ?? customer ?? null;
  const typed = state.status === "error" ? state.values : undefined;
  /** defaultValue precedence: what the user just typed → the row → "". */
  const initial = (field: CustomerField, fallback: string | null | undefined): string =>
    typed?.[field] ?? fallback ?? "";
  const currency = defaultCurrencyForCountry(country);
  const countryListed = PREFERRED_SET.has(country) || isCountryCode(country);

  const disabled = readOnly;
  const errorId = (field: CustomerField) => describedBy(`customer-${field}`, {
    error: Boolean(fieldError(field)),
  });

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      <FormError message={formError} />

      <fieldset className="grid gap-5 md:grid-cols-2" disabled={disabled}>
        <legend className="panel-title mb-4">{t.form.sectionDetails}</legend>

        <Field
          label={t.form.name}
          htmlFor="customer-name"
          error={fieldError("name")}
          requiredLabel={c.common.ui.required}
          className="md:col-span-2"
        >
          <Input
            id="customer-name"
            name="name"
            defaultValue={initial("name", current?.name)}
            maxLength={200}
            required
            autoComplete="organization"
            invalid={Boolean(fieldError("name"))}
            aria-describedby={errorId("name")}
          />
        </Field>

        <Field
          label={t.form.vatId}
          htmlFor="customer-vat_id"
          error={fieldError("vat_id")}
          help={t.form.vatIdHelp}
        >
          <Input
            id="customer-vat_id"
            name="vat_id"
            defaultValue={initial("vat_id", current?.vat_id)}
            maxLength={32}
            className="mono"
            invalid={Boolean(fieldError("vat_id"))}
            aria-describedby={describedBy("customer-vat_id", {
              help: true,
              error: Boolean(fieldError("vat_id")),
            })}
          />
        </Field>

        <Field
          label={t.form.country}
          htmlFor="customer-country"
          error={fieldError("country")}
          help={interpolate(t.form.currencyHint, { currency: c.common.currency[currency] })}
        >
          <Select
            id="customer-country"
            name="country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            invalid={Boolean(fieldError("country"))}
            aria-describedby={describedBy("customer-country", {
              help: true,
              error: Boolean(fieldError("country")),
            })}
          >
            {!countryListed && <option value={country}>{country}</option>}
            <optgroup label={t.form.countryGroupPreferred}>
              {PREFERRED_COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} — {t.countries[code]}
                </option>
              ))}
            </optgroup>
            <optgroup label={t.form.countryGroupOther}>
              {otherCountries.map((code) => (
                <option key={code} value={code}>
                  {code} — {countryName(code, c.locale)}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>

        <Field
          label={t.form.address}
          htmlFor="customer-address"
          error={fieldError("address")}
          className="md:col-span-2"
        >
          <Textarea
            id="customer-address"
            name="address"
            rows={3}
            defaultValue={initial("address", current?.address)}
            maxLength={500}
            autoComplete="street-address"
            invalid={Boolean(fieldError("address"))}
            aria-describedby={errorId("address")}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-5 md:grid-cols-2" disabled={disabled}>
        <legend className="panel-title mb-4">{t.form.sectionContact}</legend>

        <Field label={t.form.email} htmlFor="customer-email" error={fieldError("email")}>
          <Input
            id="customer-email"
            name="email"
            type="email"
            defaultValue={initial("email", current?.email)}
            maxLength={200}
            autoComplete="email"
            invalid={Boolean(fieldError("email"))}
            aria-describedby={errorId("email")}
          />
        </Field>

        <Field label={t.form.phone} htmlFor="customer-phone" error={fieldError("phone")}>
          <Input
            id="customer-phone"
            name="phone"
            type="tel"
            defaultValue={initial("phone", current?.phone)}
            maxLength={40}
            autoComplete="tel"
            invalid={Boolean(fieldError("phone"))}
            aria-describedby={errorId("phone")}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-5 md:grid-cols-2" disabled={disabled}>
        <legend className="panel-title mb-4">{t.form.sectionPreferences}</legend>

        <Field
          label={t.form.customerClass}
          htmlFor="customer-customer_class"
          error={fieldError("customer_class")}
        >
          <Select
            id="customer-customer_class"
            name="customer_class"
            defaultValue={initial("customer_class", current?.customer_class ?? DEFAULT_CUSTOMER_CLASS)}
            invalid={Boolean(fieldError("customer_class"))}
            aria-describedby={errorId("customer_class")}
          >
            {CUSTOMER_CLASSES.map((code) => (
              <option key={code} value={code}>
                {t.classes[code]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t.form.preferredLocale}
          htmlFor="customer-preferred_locale"
          error={fieldError("preferred_locale")}
          help={t.form.preferredLocaleHelp}
        >
          <Select
            id="customer-preferred_locale"
            name="preferred_locale"
            defaultValue={initial("preferred_locale", current?.preferred_locale)}
            invalid={Boolean(fieldError("preferred_locale"))}
            aria-describedby={describedBy("customer-preferred_locale", {
              help: true,
              error: Boolean(fieldError("preferred_locale")),
            })}
          >
            <option value="">{t.form.preferredLocaleNone}</option>
            <option value="pl">{c.common.locales.pl}</option>
            <option value="en">{c.common.locales.en}</option>
          </Select>
        </Field>

        <Field
          label={t.form.notes}
          htmlFor="customer-notes"
          error={fieldError("notes")}
          className="md:col-span-2"
        >
          <Textarea
            id="customer-notes"
            name="notes"
            rows={4}
            defaultValue={initial("notes", current?.notes)}
            maxLength={2000}
            invalid={Boolean(fieldError("notes"))}
            aria-describedby={errorId("notes")}
          />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <Link href={routes.customers} className="btn btn-ghost btn-sm">
          {t.form.backToList}
        </Link>
        {!readOnly && (
          <SubmitButton arrow>{mode === "create" ? t.form.create : t.form.save}</SubmitButton>
        )}
      </div>
    </form>
  );
}
