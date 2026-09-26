"use client";

/**
 * NewQuoteForm — header form for a new quote: type, customer, currency
 * (defaults from the customer's country, editable), fx rate (env
 * default), margin (rate default or customer-class margin), validity,
 * lead time, payment terms (content default), notes.
 * File path: /components/quote/new-quote-form.tsx
 *
 * Posts the createQuote server action through useActionState; the action
 * redirects to the quote on success and echoes the typed values with an
 * error code otherwise (React 19 resets the form after the action, so
 * every control takes its defaultValue from `state.values` first).
 * Selecting a customer re-derives the currency and the margin (class
 * margin from the rate snapshot's marginByClass) unless the user already
 * touched those fields.
 */

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { FormError } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { routes } from "@/lib/routes";
import { defaultCurrencyForCountry } from "@/lib/customers/currency";
import type { CustomerOption } from "@/lib/quotes/queries";
import { CURRENCIES, INITIAL_NEW_QUOTE_STATE, QUOTE_TYPES, type NewQuoteFormState } from "@/lib/quotes/schema";

export type NewQuoteFormProps = {
  action: (state: NewQuoteFormState, formData: FormData) => Promise<NewQuoteFormState>;
  customers: CustomerOption[];
  defaults: {
    fxEurPln: number;
    marginPct: number | null;
    marginByClass: Record<string, number>;
    validityDays: number;
    paymentTerms: string;
    leadTime: string;
  };
  /** Preselected customer (e.g. from the customer page). */
  customerId?: string | null;
};

export function NewQuoteForm({ action, customers, defaults, customerId: initialCustomerId }: NewQuoteFormProps) {
  const c = useContent();
  const t = c.quote.builder.create;
  const [state, formAction] = useActionState(action, INITIAL_NEW_QUOTE_STATE);
  const typed = state.status === "error" ? state.values : undefined;

  const [customerId, setCustomerId] = useState(typed?.customerId ?? initialCustomerId ?? "");
  const [currency, setCurrency] = useState<string>(typed?.currency ?? "");
  const [margin, setMargin] = useState<number | null>(typed ? Number(typed.marginPct) || null : defaults.marginPct);
  const currencyTouched = useRef(Boolean(typed?.currency));
  const marginTouched = useRef(Boolean(typed?.marginPct));

  const selected = customers.find((customer) => customer.id === customerId) ?? null;
  const derivedCurrency = defaultCurrencyForCountry(selected?.country ?? "PL");

  useEffect(() => {
    if (!currencyTouched.current) setCurrency(derivedCurrency);
    if (!marginTouched.current) {
      const byClass = selected ? defaults.marginByClass[selected.customer_class] : undefined;
      setMargin(typeof byClass === "number" ? byClass : defaults.marginPct);
    }
  }, [derivedCurrency, selected, defaults.marginByClass, defaults.marginPct]);

  const effectiveCurrency = currency || derivedCurrency;
  const error = state.status === "error" && state.error ? c.quote.builder.errors[state.error] : null;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormError message={error} />

      <div className="grid gap-5 md:grid-cols-2">
        <Field label={t.type} htmlFor="quote-type">
          <Select id="quote-type" name="type" defaultValue={typed?.type ?? "fabrication"}>
            {QUOTE_TYPES.map((value) => (
              <option key={value} value={value}>
                {c.quote.builder.types[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.customer} htmlFor="quote-customer">
          <Select
            id="quote-customer"
            name="customerId"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">{t.noCustomer}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} · {customer.country}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.currency} htmlFor="quote-currency" help={t.currencyHelp}>
          <Select
            id="quote-currency"
            name="currency"
            value={effectiveCurrency}
            onChange={(event) => {
              currencyTouched.current = true;
              setCurrency(event.target.value);
            }}
            aria-describedby={describedBy("quote-currency", { help: true })}
          >
            {CURRENCIES.map((value) => (
              <option key={value} value={value}>
                {c.common.currency[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.fxRate} htmlFor="quote-fx" help={t.fxRateHelp}>
          <NumberInput
            id="quote-fx"
            name="fxRate"
            defaultValue={typed ? Number(typed.fxRate) || defaults.fxEurPln : defaults.fxEurPln}
            decimals={4}
            min={0.0001}
            disabled={effectiveCurrency === "EUR"}
            aria-describedby={describedBy("quote-fx", { help: true })}
          />
          {effectiveCurrency === "EUR" && <input type="hidden" name="fxRate" value="1" />}
        </Field>

        <Field label={t.margin} htmlFor="quote-margin" help={t.marginHelp}>
          <NumberInput
            id="quote-margin"
            name="marginPct"
            value={margin}
            onValueChange={(value) => {
              marginTouched.current = true;
              setMargin(value);
            }}
            decimals={2}
            min={0}
            max={99.99}
            aria-describedby={describedBy("quote-margin", { help: true })}
          />
        </Field>

        <Field label={t.validityDays} htmlFor="quote-validity">
          <NumberInput
            id="quote-validity"
            name="validityDays"
            defaultValue={typed ? Number(typed.validityDays) || defaults.validityDays : defaults.validityDays}
            decimals={0}
            min={1}
            max={365}
          />
        </Field>

        <Field label={t.leadTime} htmlFor="quote-lead" className="md:col-span-2">
          <Input id="quote-lead" name="leadTimeText" defaultValue={typed?.leadTimeText ?? defaults.leadTime} maxLength={200} />
        </Field>

        <Field label={t.paymentTerms} htmlFor="quote-terms" className="md:col-span-2">
          <Textarea
            id="quote-terms"
            name="paymentTermsText"
            rows={3}
            defaultValue={typed?.paymentTermsText ?? defaults.paymentTerms}
            maxLength={2000}
          />
        </Field>

        <Field label={t.notes} htmlFor="quote-notes" className="md:col-span-2">
          <Textarea id="quote-notes" name="notes" rows={3} defaultValue={typed?.notes ?? ""} maxLength={4000} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <Link href={routes.quotes} className="btn btn-ghost btn-sm">
          {t.cancel}
        </Link>
        <SubmitButton arrow>{t.submit}</SubmitButton>
      </div>
    </form>
  );
}
