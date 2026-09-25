"use client";

/**
 * CustomerForm — create / edit form for a customer (name, VAT id, country,
 * address, e-mail, phone, class, preferred locale, notes).
 * File path: /components/customers/customer-form.tsx
 *
 * Driven by useActionState over a server action reducer
 * (createCustomer or updateCustomer.bind(null, id)); field errors come
 * back as codes and are mapped to copy here. Country is controlled only
 * to show the default-currency hint (PLN for PL, EUR otherwise — rule in
 * lib/customers/currency.ts). Everything else is uncontrolled so the
 * browser keeps typed values across a failed submit. `readOnly` renders
 * the viewer role's disabled version.
 */

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { FormError } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { interpolate } from "@/components/ui/format";
import { routes } from "@/lib/routes";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";
import {
  COUNTRY_CODES,
  CUSTOMER_CLASSES,
  DEFAULT_COUNTRY,
  DEFAULT_CUSTOMER_CLASS,
  INITIAL_CUSTOMER_FORM_STATE,
  type CustomerField,
  type CustomerFormState,
} from "@/lib/customers/schema";
import type { CustomerRow } from "@/lib/db/types";
import type { CustomerCountryCode } from "@/content/quote";

export type CustomerFormProps = {
  mode: "create" | "edit";
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  customer?: CustomerRow | null;
  readOnly?: boolean;
};

export function CustomerForm({ mode, action, customer, readOnly = false }: CustomerFormProps) {
  const c = useContent();
  const t = c.quote.customers;
  const { toast } = useToast();
  const [state, formAction] = useActionState(action, INITIAL_CUSTOMER_FORM_STATE);
  const [country, setCountry] = useState<string>(customer?.country ?? DEFAULT_COUNTRY);
  const lastToasted = useRef<CustomerFormState | null>(null);

  useEffect(() => {
    if (state.status === "saved" && lastToasted.current !== state) {
      lastToasted.current = state;
      toast(t.form.saved, { tone: "success" });
    }
  }, [state, toast, t.form.saved]);

  const fieldError = (field: CustomerField): string | undefined => {
    const code = state.fieldErrors?.[field];
    return code ? t.errors[code] : undefined;
  };
  const formError = state.error ? t.errors[state.error] : null;
  const current = state.customer ?? customer ?? null;
  const currency = defaultCurrencyForCountry(country);
  const countryKnown = (COUNTRY_CODES as readonly string[]).includes(country);

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
            defaultValue={current?.name ?? ""}
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
            defaultValue={current?.vat_id ?? ""}
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
            {!countryKnown && <option value={country}>{country}</option>}
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {code} — {t.countries[code as CustomerCountryCode]}
              </option>
            ))}
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
            defaultValue={current?.address ?? ""}
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
            defaultValue={current?.email ?? ""}
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
            defaultValue={current?.phone ?? ""}
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
            defaultValue={current?.customer_class ?? DEFAULT_CUSTOMER_CLASS}
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
            defaultValue={current?.preferred_locale ?? ""}
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
            defaultValue={current?.notes ?? ""}
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
