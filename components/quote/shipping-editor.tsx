"use client";

/**
 * ShippingEditor — the shipping block of the quote header: destination
 * country (defaults from the customer), gross mass (typed or computed
 * from the parts + packaging allowance), cost (typed or the
 * shipping_rates band of the destination, shown resolved), carrier and
 * extra transport days. Null = no shipping line (collection).
 * File path: /components/quote/shipping-editor.tsx
 *
 * Copy-free; state lives in the header (components/quote/header-state.ts
 * ShippingState) and is saved with the header through updateQuoteHeader.
 * The resolved band is looked up with the engine's own pickShippingBand on
 * the page's JobRates so the label always agrees with the price the
 * engine will charge; the computed mass comes from the priced result
 * (packaging / shipping line details) — never recomputed here.
 */

import { useMemo } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { ALL_COUNTRY_CODES, countryName, sortCountryCodesByName } from "@/lib/customers/countries";
import { PREFERRED_COUNTRY_CODES } from "@/lib/customers/schema";
import { formatNumber, interpolate } from "@/lib/format";
import { pickShippingBand } from "@/lib/pricing/shipping";
import type { JobRates } from "@/lib/pricing/types";
import { defaultShippingState, type ShippingState } from "./header-state";
import type { MoneyFormatter } from "./money";

export type ShippingEditorProps = {
  value: ShippingState | null;
  onChange: (next: ShippingState | null) => void;
  disabled: boolean;
  /** ISO-2 of the selected customer (the default destination). */
  customerCountry: string | null;
  jobRates: JobRates | null;
  /** Gross mass the engine computed for the current pricing (null before the first pricing run). */
  computedGrossKg: number | null;
  money: MoneyFormatter;
};

const PREFERRED: ReadonlySet<string> = new Set(PREFERRED_COUNTRY_CODES);

export function ShippingEditor({ value, onChange, disabled, customerCountry, jobRates, computedGrossKg, money }: ShippingEditorProps) {
  const c = useContent();
  const t = c.quote.builder.shipping;
  const otherCountries = useMemo(
    () => sortCountryCodesByName(ALL_COUNTRY_CODES.filter((code) => !PREFERRED.has(code)), c.locale),
    [c.locale]
  );

  if (!value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-text-muted">{t.none}</p>
        {!disabled && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(defaultShippingState(customerCountry))}>
            {t.enable}
          </button>
        )}
      </div>
    );
  }

  const patch = (next: Partial<ShippingState>) => onChange({ ...value, ...next });
  const massForBand = value.grossKg ?? computedGrossKg;
  const band = jobRates && massForBand !== null && value.countryCode.length === 2 ? pickShippingBand(jobRates.shipping, value.countryCode, massForBand) : null;
  const countryListed = PREFERRED.has(value.countryCode) || ALL_COUNTRY_CODES.includes(value.countryCode);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Field label={t.country} htmlFor="q-ship-country">
        <Select id="q-ship-country" dense value={value.countryCode} disabled={disabled} onChange={(e) => patch({ countryCode: e.target.value })}>
          {!countryListed && <option value={value.countryCode}>{value.countryCode}</option>}
          <optgroup label={c.quote.customers.form.countryGroupPreferred}>
            {PREFERRED_COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {code} — {c.quote.customers.countries[code]}
              </option>
            ))}
          </optgroup>
          <optgroup label={c.quote.customers.form.countryGroupOther}>
            {otherCountries.map((code) => (
              <option key={code} value={code}>
                {code} — {countryName(code, c.locale)}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      <Field
        label={t.grossKg}
        htmlFor="q-ship-kg-mode"
        help={
          value.grossKg === null
            ? computedGrossKg !== null
              ? interpolate(t.grossKgComputedValue, { kg: formatNumber(computedGrossKg, c.locale, { maximumFractionDigits: 2 }) })
              : t.grossKgUnknown
            : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="q-ship-kg-mode"
            dense
            inline
            value={value.grossKg === null ? "computed" : "manual"}
            disabled={disabled}
            onChange={(e) => patch({ grossKg: e.target.value === "manual" ? (computedGrossKg ?? 1) : null })}
          >
            <option value="computed">{t.grossKgComputed}</option>
            <option value="manual">{t.grossKgManual}</option>
          </Select>
          {value.grossKg !== null && (
            <NumberInput
              aria-label={t.grossKg}
              dense
              inline
              className="w-[110px]"
              value={value.grossKg}
              decimals={2}
              min={0.01}
              disabled={disabled}
              onValueChange={(v) => v !== null && patch({ grossKg: v })}
            />
          )}
        </div>
      </Field>

      <Field
        label={t.costSource}
        htmlFor="q-ship-source"
        help={
          value.source === "table"
            ? !jobRates
              ? t.noRates
              : band
                ? interpolate(t.band, { carrier: band.carrier ?? "—", maxKg: formatNumber(band.maxKg, c.locale), price: money(band.priceEur) })
                : massForBand === null
                  ? t.grossKgUnknown
                  : t.noBand
            : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="q-ship-source"
            dense
            inline
            value={value.source}
            disabled={disabled}
            onChange={(e) => {
              const source = e.target.value === "manual" ? "manual" : "table";
              patch({ source, costEur: source === "manual" ? (value.costEur ?? band?.priceEur ?? 0) : null });
            }}
          >
            <option value="table">{t.sourceTable}</option>
            <option value="manual">{t.sourceManual}</option>
          </Select>
          {value.source === "manual" && (
            <NumberInput
              aria-label={t.costEur}
              dense
              inline
              className="w-[110px]"
              value={value.costEur}
              decimals={2}
              min={0}
              disabled={disabled}
              onValueChange={(v) => patch({ costEur: v })}
            />
          )}
        </div>
      </Field>

      <Field label={t.carrier} htmlFor="q-ship-carrier" help={value.source === "table" && !value.carrier && band?.carrier ? `${t.carrierFromBand}: ${band.carrier}` : undefined}>
        <Input id="q-ship-carrier" dense value={value.carrier} maxLength={80} disabled={disabled} onChange={(e) => patch({ carrier: e.target.value })} />
      </Field>

      <Field label={t.extraLeadDays} htmlFor="q-ship-days" help={t.extraLeadDaysHelp}>
        <NumberInput
          id="q-ship-days"
          dense
          value={value.extraLeadDays}
          decimals={0}
          min={0}
          max={365}
          disabled={disabled}
          onValueChange={(v) => v !== null && patch({ extraLeadDays: Math.max(0, Math.round(v)) })}
        />
      </Field>

      {!disabled && (
        <div className="flex items-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            {t.disable}
          </button>
        </div>
      )}
    </div>
  );
}
