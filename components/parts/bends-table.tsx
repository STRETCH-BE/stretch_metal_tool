"use client";

/**
 * BendsTable — every bend the pricing engine sees (layer lines, drawn
 * lines, tagged entities) with direction / angle / radius editable per
 * row; Save posts setBendParams for that bend.
 * File path: /components/parts/bends-table.tsx
 *
 * Rows come from lib/parts/annotation-edits materialiseBends so the
 * table shows exactly what will be priced. Enter inside a row's inputs
 * saves the row (form per row).
 */

import { useId, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { NumberInput } from "@/components/ui/number-input";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatMm } from "@/lib/format";
import type { BendAnnotation, BendLine } from "@/lib/geometry/types";
import type { BendParams } from "@/lib/parts/schema";

export type BendRow = BendAnnotation & { source: BendLine["source"] | "annotation" };

export type BendsTableProps = {
  bends: BendRow[];
  thicknessMm: number | null;
  disabled?: boolean;
  onSave: (bendId: string, params: BendParams) => void;
};

export function BendsTable({ bends, thicknessMm, disabled = false, onSave }: BendsTableProps) {
  const c = useContent();
  const t = c.upload.part.bends;
  return (
    <Panel title={c.upload.part.panels.bends} flush>
      {bends.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-text-muted">{t.empty}</p>
      ) : (
        <TableWrap>
          <Table dense>
            <thead>
              <tr>
                <Th>{t.direction}</Th>
                <Th align="num">{t.length}</Th>
                <Th align="num">{t.angle}</Th>
                <Th align="num">{t.radius}</Th>
                <Th>{t.source}</Th>
                <Th>{c.common.table.actions}</Th>
              </tr>
            </thead>
            <tbody>
              {bends.map((bend, index) => (
                <BendRowView key={bend.id} index={index} bend={bend} thicknessMm={thicknessMm} disabled={disabled} onSave={onSave} />
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}

function BendRowView({ bend, index, thicknessMm, disabled, onSave }: { bend: BendRow; index: number; thicknessMm: number | null; disabled: boolean; onSave: BendsTableProps["onSave"] }) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.bends;
  const id = useId();
  const [direction, setDirection] = useState<"up" | "down">(bend.direction);
  const [angle, setAngle] = useState<number | null>(bend.angleDeg);
  const [radius, setRadius] = useState<number | null>(bend.radiusMm);
  const formId = `${id}-form`;
  const dirty = direction !== bend.direction || angle !== bend.angleDeg || radius !== bend.radiusMm;
  const sourceLabel = bend.source === "annotation" ? t.sources.drawn : t.sources[bend.source];

  const save = () => {
    if (angle === null) return;
    onSave(bend.id, { angleDeg: angle, radiusMm: radius, direction });
  };

  return (
    <tr>
      <Td>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        />
        <label htmlFor={`${id}-dir`} className="visually-hidden">
          {t.direction} {index + 1}
        </label>
        <select
          id={`${id}-dir`}
          form={formId}
          className="field field-sm field-inline"
          disabled={disabled}
          value={direction}
          onChange={(event) => setDirection(event.target.value === "down" ? "down" : "up")}
        >
          <option value="up">{t.up}</option>
          <option value="down">{t.down}</option>
        </select>
      </Td>
      <Td align="num">{formatMm(bend.lengthMm, locale)}</Td>
      <Td align="num">
        <label htmlFor={`${id}-angle`} className="visually-hidden">
          {t.angle} {index + 1}
        </label>
        <NumberInput id={`${id}-angle`} form={formId} value={angle} onValueChange={setAngle} min={1} max={179} decimals={1} dense inline className="w-[84px]" disabled={disabled} />
      </Td>
      <Td align="num">
        <label htmlFor={`${id}-radius`} className="visually-hidden">
          {t.radius} {index + 1}
        </label>
        <NumberInput
          id={`${id}-radius`}
          form={formId}
          value={radius}
          onValueChange={setRadius}
          min={0}
          decimals={2}
          dense
          inline
          className="w-[96px]"
          placeholder={thicknessMm === null ? t.radiusDefault : `${formatMm(thicknessMm, locale)}`}
          disabled={disabled}
        />
      </Td>
      <Td muted>{sourceLabel}</Td>
      <Td>
        <button type="submit" form={formId} className="btn btn-ghost btn-sm" disabled={disabled || !dirty || angle === null}>
          {t.save}
        </button>
      </Td>
    </tr>
  );
}
