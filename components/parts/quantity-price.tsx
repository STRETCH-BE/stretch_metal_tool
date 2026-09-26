"use client";

/**
 * QuantityPrice — qty input (quote_items.qty via setItemQty + reprice)
 * and the server-priced unit cost / unit price / batch price in the
 * quote currency (toQuoteCurrency with the quote's stored fx rate).
 * File path: /components/parts/quantity-price.tsx
 */

import { useId, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { formatMoney, interpolate, toQuoteCurrency } from "@/lib/format";

export type QuantityPriceProps = {
  qty: number;
  unitCostEur: number;
  unitPriceEur: number;
  currency: "PLN" | "EUR";
  fxRate: number;
  priced: boolean;
  disabled?: boolean;
  onQtyChange: (qty: number) => void;
};

export function QuantityPrice({ qty, unitCostEur, unitPriceEur, currency, fxRate, priced, disabled = false, onQtyChange }: QuantityPriceProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.quantity;
  const id = useId();
  const [value, setValue] = useState<number | null>(qty);
  const dirty = value !== null && value !== qty;
  const money = (eur: number) => formatMoney(toQuoteCurrency(eur, currency, fxRate), currency, locale);

  return (
    <Panel title={c.upload.part.panels.quantity} actions={<span className="text-[11px] text-text-faint">{interpolate(t.inCurrency, { currency })}</span>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (value !== null && value >= 1) onQtyChange(Math.round(value));
        }}
      >
        <div className="flex items-end gap-2">
          <Field label={t.qty} htmlFor={`${id}-qty`} className="w-[140px]">
            <NumberInput id={`${id}-qty`} value={value} onValueChange={setValue} min={1} decimals={0} dense disabled={disabled} />
          </Field>
          <button type="submit" className="btn btn-ghost btn-sm" disabled={disabled || !dirty}>
            {c.common.actions.apply}
          </button>
        </div>
        <table className="tbl tbl-dense">
          <tbody>
            <tr>
              <td className="text-text-muted">{t.unitCost}</td>
              <td className="num money">{priced ? money(unitCostEur) : t.notPriced}</td>
            </tr>
            <tr>
              <td className="text-text-muted">{t.unitPrice}</td>
              <td className="num money">{priced ? money(unitPriceEur) : t.notPriced}</td>
            </tr>
            <tr>
              <td className="font-bold">{t.batchPrice}</td>
              <td className="num money font-bold">{priced ? money(unitPriceEur * qty) : t.notPriced}</td>
            </tr>
          </tbody>
        </table>
      </form>
    </Panel>
  );
}
