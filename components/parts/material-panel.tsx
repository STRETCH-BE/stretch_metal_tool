"use client";

/**
 * MaterialPanel — material select (code + name from the rate snapshot)
 * and thickness input with the flat-laser family limit hint; Save posts
 * setPartMaterial (re-measures mass / slow contours, re-prices).
 * File path: /components/parts/material-panel.tsx
 *
 * The form is keyed on the server values (lib/parts/server-key.ts): when
 * another panel changes material / thickness (accepting an AI suggestion)
 * the refreshed props remount it, so it never offers to save the stale
 * value back.
 *
 * Market version (rates.pricingMode = 'market'): only the version's
 * benchmarked (material, thickness) pairs are offered — materials without
 * a laser row are listed disabled as "not benchmarked", the thickness is a
 * select of the material's benchmarked thicknesses (ThicknessInput), and a
 * pair outside the benchmark shows the "quote manually" notice (the
 * engine refuses it with market.no_benchmark_rate).
 */

import { useId, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatMm, interpolate } from "@/lib/format";
import { familyThicknessLimitMm } from "@/lib/pricing/lookup";
import { isBenchmarked } from "@/lib/parts/material-choices";
import type { RatesInfo } from "@/lib/parts/queries";
import { serverKey } from "@/lib/parts/server-key";
import { ThicknessInput } from "./thickness-input";

export type MaterialPanelProps = {
  materialCode: string | null;
  thicknessMm: number | null;
  rates: RatesInfo;
  disabled?: boolean;
  onSave: (input: { materialCode: string | null; thicknessMm: number | null }) => void;
};

export function MaterialPanel(props: MaterialPanelProps) {
  return <MaterialForm key={serverKey(props.materialCode, props.thicknessMm)} {...props} />;
}

function MaterialForm({ materialCode, thicknessMm, rates, disabled = false, onSave }: MaterialPanelProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.material;
  const id = useId();
  const [code, setCode] = useState(materialCode ?? "");
  const [thickness, setThickness] = useState<number | null>(thicknessMm);
  const known = rates.materials.find((m) => m.code === code) ?? null;
  const unknownCode = code.length > 0 && !known;
  const market = rates.pricingMode === "market";
  const choice = rates.choices.find((m) => m.code === code) ?? null;
  const limit = known ? familyThicknessLimitMm(rates.flatLaser?.limits ?? null, known.family) : null;
  const dirty = code !== (materialCode ?? "") || thickness !== thicknessMm;
  const overLimit = limit !== null && thickness !== null && thickness > limit;
  const notBenchmarked = market && code.length > 0 && thickness !== null && !isBenchmarked(choice, thickness);

  return (
    <Panel title={c.upload.part.panels.material}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ materialCode: code || null, thicknessMm: thickness });
        }}
      >
        {rates.materials.length === 0 && <Notice tone="error">{t.noRates}</Notice>}
        <Field label={t.code} htmlFor={`${id}-code`}>
          <Select id={`${id}-code`} value={code} onChange={(event) => setCode(event.target.value)} dense disabled={disabled}>
            <option value="">{t.none}</option>
            {unknownCode && <option value={code}>{code}</option>}
            {rates.choices.map((m) => (
              <option key={m.code} value={m.code} disabled={m.notBenchmarked && m.code !== code}>
                {m.code} — {m.name}
                {m.notBenchmarked ? ` — ${t.notBenchmarked}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        {unknownCode && <p className="text-[12px] text-red">{t.unknownCode}</p>}
        <Field
          label={t.thickness}
          htmlFor={`${id}-t`}
          help={
            market
              ? t.benchmarkedHint
              : known
                ? limit !== null && rates.flatLaser
                  ? interpolate(t.limitHint, { limitMm: formatMm(limit, locale), family: c.flags.families[known.family], machine: rates.flatLaser.name })
                  : t.noLimit
                : undefined
          }
        >
          <ThicknessInput id={`${id}-t`} value={thickness} onValueChange={setThickness} choice={choice} market={market} emptyLabel={t.none} disabled={disabled} invalid={overLimit || notBenchmarked} />
        </Field>
        {notBenchmarked && <Notice tone="error">{t.notBenchmarkedHint}</Notice>}
        <div>
          <button type="submit" className="btn btn-ghost btn-sm" disabled={disabled || !dirty}>
            {t.save}
          </button>
        </div>
      </form>
    </Panel>
  );
}
