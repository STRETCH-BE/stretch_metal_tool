"use client";

/**
 * ExtrasEditor — modal per item for the operations a user adds by hand:
 * machining minutes, hole features (code + count from rate_feature),
 * finish (code from rate_finish + masking minutes), other lump sums and
 * handling; plus the item's scrap % override.
 * File path: /components/quote/extras-editor.tsx
 *
 * Edits are pushed to the parent on every change (live preview) and
 * persisted on Save (updateItem → server re-price). Feature and finish
 * options come from the rate snapshot passed to the page, so the list
 * always matches the version the quote is pinned to. Costs of "other"
 * and "handling" lines are EUR (the rate-table currency), as the label
 * says. A market version without feature / finish rows greys those
 * buttons and says "not benchmarked — quote manually" (a lump-sum
 * "other" line is the manual route; the engine flags it market.manual_price).
 * Options with no eligible row for the part's material / thickness
 * (lib/pricing/eligibility.ts) are listed disabled with the same suffix;
 * material variants of a finish (deburr_nonferrous) are hidden — the engine
 * picks the row. A finish whose minimum is per colour (powder) gets a
 * colour input, prefilled with DEFAULT_COLOUR.
 */

import { useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { Notice } from "@/components/ui/notice";
import type { QuoteItemRow } from "@/lib/db/types";
import { interpolate } from "@/lib/format";
import { featureEligibility, finishEligibility, finishRefused, finishesOffered, resolveFinishRate } from "@/lib/pricing/eligibility";
import type { ExtraOperation, FeatureRate, FinishRate, MaterialFamily, RateSnapshot } from "@/lib/pricing/types";

/** Prefilled colour of a per-colour finish (the benchmark's default RAL). */
const DEFAULT_COLOUR = "RAL 9005";

export type ExtrasEditorPart = { materialCode: string | null; thicknessMm: number | null; family: MaterialFamily | null };

export type ExtrasEditorProps = {
  open: boolean;
  item: QuoteItemRow;
  partName: string;
  /** Material / thickness of the part: options without an eligible row are greyed. */
  part: ExtrasEditorPart;
  extras: ExtraOperation[];
  scrapPct: number | null;
  rates: RateSnapshot | null;
  pending: boolean;
  onChange: (extras: ExtraOperation[]) => void;
  onSave: (extras: ExtraOperation[], scrapPct: number | null) => void;
  onClose: () => void;
};

export function ExtrasEditor({ open, partName, part, extras, scrapPct, rates, pending, onChange, onSave, onClose }: ExtrasEditorProps) {
  const c = useContent();
  const t = c.quote.builder.extras;
  const [scrap, setScrap] = useState<number | null>(scrapPct);
  const features = rates?.feature ?? [];
  const finishes = rates ? finishesOffered(rates) : [];
  const market = rates?.general.pricingMode === "market";
  const notBenchmarked = market ? [features.length === 0 ? t.features : null, finishes.length === 0 ? t.finish : null].filter((x): x is string => x !== null) : [];
  const featureOk = (f: FeatureRate) => !market || featureEligibility(f, part.materialCode, part.thicknessMm) === "ok";
  const finishOk = (f: FinishRate) => {
    if (!market || !rates) return true;
    const rate = resolveFinishRate(rates, f.code, part.materialCode) ?? f;
    return !finishRefused(finishEligibility(rate, { materialCode: part.materialCode, thicknessMm: part.thicknessMm, family: part.family }));
  };
  const finishRate = (code: string): FinishRate | null => (rates ? (resolveFinishRate(rates, code, part.materialCode) ?? null) : null);
  const firstFeature = features.find(featureOk) ?? features[0];
  const firstFinish = finishes.find(finishOk) ?? finishes[0];
  const withColour = (extra: Extract<ExtraOperation, { type: "finish" }>, code: string): Extract<ExtraOperation, { type: "finish" }> => {
    const perColour = finishRate(code)?.minimumScope === "colour";
    return { ...extra, code, colour: perColour ? (extra.colour?.trim() ? extra.colour : DEFAULT_COLOUR) : null };
  };

  const update = (index: number, next: ExtraOperation) => {
    const list = extras.map((e, i) => (i === index ? next : e));
    onChange(list);
  };
  const remove = (index: number) => onChange(extras.filter((_, i) => i !== index));
  const add = (extra: ExtraOperation) => onChange([...extras, extra]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={interpolate(t.title, { name: partName })}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {c.common.actions.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => onSave(extras, scrap)}>
            {t.save}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info">{t.costEur}</Notice>
        {notBenchmarked.length > 0 && <Notice tone="info">{interpolate(t.notBenchmarked, { what: notBenchmarked.join(", ") })}</Notice>}

        <Field label={c.quote.builder.parts.scrap} htmlFor="extras-scrap" help={c.quote.builder.parts.scrapDefault}>
          <NumberInput id="extras-scrap" value={scrap} onValueChange={setScrap} decimals={1} min={0} max={500} dense inline className="w-[120px]" />
        </Field>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add({ type: "machining", minutes: 0, note: null })}>
            {t.add}: {t.machining}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={features.length === 0}
            onClick={() => add({ type: "feature", code: firstFeature?.code ?? "", count: 1 })}
          >
            {t.add}: {t.features}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={finishes.length === 0}
            onClick={() => add(withColour({ type: "finish", code: firstFinish?.code ?? "", maskingMinutes: 0, note: null }, firstFinish?.code ?? ""))}
          >
            {t.add}: {t.finish}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add({ type: "other", label: "", unitCost: 0 })}>
            {t.add}: {t.other}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add({ type: "handling", unitCost: 0 })}>
            {t.add}: {t.handling}
          </button>
        </div>

        {extras.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border">
            {extras.map((extra, index) => (
              <li key={index} className="flex flex-wrap items-end gap-3 p-3">
                <span className="chip chip-neutral chip-plain">
                  {extra.type === "machining"
                    ? t.machining
                    : extra.type === "feature"
                      ? t.features
                      : extra.type === "finish"
                        ? t.finish
                        : extra.type === "other"
                          ? t.other
                          : extra.type === "handling"
                            ? t.handling
                            : extra.type}
                </span>
                {extra.type === "machining" && (
                  <Field label={t.machiningMinutes} htmlFor={`extra-${index}-minutes`}>
                    <NumberInput
                      id={`extra-${index}-minutes`}
                      value={extra.minutes}
                      onValueChange={(v) => update(index, { ...extra, minutes: v ?? 0 })}
                      decimals={1}
                      min={0}
                      dense
                      inline
                      className="w-[110px]"
                    />
                  </Field>
                )}
                {extra.type === "feature" && (
                  <>
                    <Field label={t.featureCode} htmlFor={`extra-${index}-code`}>
                      <Select
                        id={`extra-${index}-code`}
                        value={extra.code}
                        dense
                        inline
                        onChange={(e) => update(index, { ...extra, code: e.target.value })}
                      >
                        {features.map((f) => (
                          <option key={f.code} value={f.code} disabled={!featureOk(f) && f.code !== extra.code}>
                            {f.name}
                            {featureOk(f) ? "" : ` — ${t.unavailable}`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t.featureCount} htmlFor={`extra-${index}-count`}>
                      <NumberInput
                        id={`extra-${index}-count`}
                        value={extra.count}
                        onValueChange={(v) => update(index, { ...extra, count: Math.max(1, Math.round(v ?? 1)) })}
                        decimals={0}
                        min={1}
                        dense
                        inline
                        className="w-[90px]"
                      />
                    </Field>
                  </>
                )}
                {extra.type === "finish" && (
                  <>
                    <Field label={t.finishCode} htmlFor={`extra-${index}-finish`}>
                      <Select
                        id={`extra-${index}-finish`}
                        value={extra.code}
                        dense
                        inline
                        onChange={(e) => update(index, withColour(extra, e.target.value))}
                      >
                        {finishes.map((f) => (
                          <option key={f.code} value={f.code} disabled={!finishOk(f) && f.code !== extra.code}>
                            {f.name}
                            {finishOk(f) ? "" : ` — ${t.unavailable}`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {finishRate(extra.code)?.minimumScope === "colour" && (
                      <Field label={t.colour} htmlFor={`extra-${index}-colour`} help={t.colourHelp}>
                        <Input
                          id={`extra-${index}-colour`}
                          value={extra.colour ?? ""}
                          dense
                          inline
                          className="w-[130px]"
                          onChange={(e) => update(index, { ...extra, colour: e.target.value })}
                        />
                      </Field>
                    )}
                    <Field label={t.maskingMinutes} htmlFor={`extra-${index}-masking`}>
                      <NumberInput
                        id={`extra-${index}-masking`}
                        value={extra.maskingMinutes}
                        onValueChange={(v) => update(index, { ...extra, maskingMinutes: v ?? 0 })}
                        decimals={1}
                        min={0}
                        dense
                        inline
                        className="w-[110px]"
                      />
                    </Field>
                  </>
                )}
                {extra.type === "other" && (
                  <>
                    <Field label={t.otherLabel} htmlFor={`extra-${index}-label`}>
                      <Input
                        id={`extra-${index}-label`}
                        value={extra.label}
                        dense
                        inline
                        className="w-[200px]"
                        maxLength={120}
                        onChange={(e) => update(index, { ...extra, label: e.target.value })}
                      />
                    </Field>
                    <Field label={t.otherCost} htmlFor={`extra-${index}-cost`}>
                      <NumberInput
                        id={`extra-${index}-cost`}
                        value={extra.unitCost}
                        onValueChange={(v) => update(index, { ...extra, unitCost: v ?? 0 })}
                        decimals={2}
                        min={0}
                        dense
                        inline
                        className="w-[120px]"
                      />
                    </Field>
                  </>
                )}
                {extra.type === "handling" && (
                  <Field label={t.handlingCost} htmlFor={`extra-${index}-handling`}>
                    <NumberInput
                      id={`extra-${index}-handling`}
                      value={extra.unitCost}
                      onValueChange={(v) => update(index, { ...extra, unitCost: v ?? 0 })}
                      decimals={2}
                      min={0}
                      dense
                      inline
                      className="w-[120px]"
                    />
                  </Field>
                )}
                <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => remove(index)}>
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
