"use client";

/**
 * PriceScaleEditor — the price-scale toggle of the quote header (quote
 * every item / assembly at extra quantities) with the editable quantity
 * list, and PriceScaleTable — the resulting prices per subject from
 * PricedQuote.priceScale.
 * File path: /components/quote/price-scale-editor.tsx
 *
 * The field keeps its own text while typing (so "20, 5" is not
 * re-formatted under the cursor) and reports the parsed quantities on
 * every change (components/quote/price-scale.ts); invalid tokens show as
 * a field error and are simply not sent. Enabling the toggle on an empty
 * list seeds the owner's default set 20/50/100/200/500/1000.
 */

import { useEffect, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatNumber, interpolate } from "@/lib/format";
import type { PriceScale } from "@/lib/pricing/types";
import { PRICE_SCALE_MAX } from "@/lib/quotes/schema";
import type { MoneyFormatter } from "./money";
import { DEFAULT_PRICE_SCALE, formatPriceScale, parsePriceScaleText, samePriceScale } from "./price-scale";

export type PriceScaleEditorProps = {
  enabled: boolean;
  values: number[];
  onChange: (next: { enabled: boolean; values: number[] }) => void;
  disabled: boolean;
};

export function PriceScaleEditor({ enabled, values, onChange, disabled }: PriceScaleEditorProps) {
  const c = useContent();
  const t = c.quote.builder.priceScale;
  const [text, setText] = useState(() => formatPriceScale(values));
  const parsed = parsePriceScaleText(text);

  // Server truth / defaults button changed the list: adopt it unless the field already parses to it.
  useEffect(() => {
    if (!samePriceScale(parsePriceScaleText(text).values, values)) setText(formatPriceScale(values));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const toggle = (next: boolean) => {
    const seeded = next && values.length === 0 ? [...DEFAULT_PRICE_SCALE] : values;
    onChange({ enabled: next, values: seeded });
  };

  const error = parsed.invalid.length > 0 ? interpolate(t.invalid, { values: parsed.invalid.join(", ") }) : parsed.truncated ? interpolate(t.tooMany, { max: PRICE_SCALE_MAX }) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="checkbox" checked={enabled} disabled={disabled} onChange={(e) => toggle(e.target.checked)} />
        {t.enable}
      </label>
      {enabled && (
        <Field label={t.quantities} htmlFor="q-price-scale" help={t.quantitiesHelp} error={error}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="q-price-scale"
              dense
              inline
              className="mono w-[320px] max-w-full"
              value={text}
              disabled={disabled}
              invalid={Boolean(error)}
              onChange={(e) => {
                setText(e.target.value);
                onChange({ enabled, values: parsePriceScaleText(e.target.value).values });
              }}
            />
            {!disabled && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ enabled, values: [...DEFAULT_PRICE_SCALE] })}>
                {t.useDefaults}
              </button>
            )}
          </div>
        </Field>
      )}
    </div>
  );
}

export type PriceScaleSubject = { name: string; kind: "item" | "assembly" };

export type PriceScaleTableProps = {
  scale: PriceScale[];
  /** subjectId → display name (part name / assembly name). */
  subjects: ReadonlyMap<string, PriceScaleSubject>;
  money: MoneyFormatter;
};

export function PriceScaleTable({ scale, subjects, money }: PriceScaleTableProps) {
  const c = useContent();
  const t = c.quote.builder.priceScale;
  if (scale.length === 0) return <p className="text-[13px] text-text-muted">{t.empty}</p>;
  return (
    <TableWrap>
      <Table dense>
        <thead>
          <tr>
            <Th>{t.columns.subject}</Th>
            <Th align="num">{t.columns.qty}</Th>
            <Th align="num">{t.columns.unitPrice}</Th>
            <Th align="num">{t.columns.total}</Th>
          </tr>
        </thead>
        <tbody>
          {scale.map((subject) =>
            subject.entries.map((entry, index) => {
              const meta = subjects.get(subject.subjectId);
              return (
                <tr key={`${subject.subjectId}-${entry.qty}`}>
                  <Td>
                    {index === 0 && (
                      <>
                        <span className="font-bold">{meta?.name ?? subject.subjectId}</span>
                        <span className="ml-2 text-[11px] uppercase text-text-faint">{t.kinds[meta?.kind ?? subject.kind]}</span>
                      </>
                    )}
                  </Td>
                  <Td align="num">{formatNumber(entry.qty, c.locale)}</Td>
                  <Td align="num" className="money" muted={entry.unitPrice === null}>
                    {entry.unitPrice === null ? t.noPrice : money(entry.unitPrice)}
                  </Td>
                  <Td align="num" className="money" muted={entry.total === null}>
                    {entry.total === null ? t.noPrice : money(entry.total)}
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}
