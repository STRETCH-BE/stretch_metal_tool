"use client";

/**
 * Sub-editors for the JSON rate columns — price bands by thickness
 * (materials.price_per_kg), sheet formats (materials.sheet_formats) and
 * margin by customer class (rate_general.margin_by_class) — inside a
 * modal that validates with the pricing engine's zod schemas on Apply.
 * File path: /components/admin/json-editors.tsx
 *
 * The editors work on a local draft; nothing reaches the grid row until
 * Apply passes priceBandsSchema / sheetFormatsSchema / marginByClassSchema
 * (the same schemas the engine parses the column with), so a value that
 * would break pricing can never be saved from here.
 */

import { useState } from "react";
import { useContent } from "@/components/providers/locale";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { Notice } from "@/components/ui/notice";
import { Table, Td, Th } from "@/components/ui/table";
import { marginByClassSchema, priceBandsSchema, sheetFormatsSchema } from "@/lib/pricing/snapshot";
import type { ColumnDef } from "@/lib/admin/tables";

type Band = { maxThicknessMm: number | null; pricePerKg: number | null };
type Format = { lengthMm: number | null; widthMm: number | null };
type Margin = { customerClass: string; marginPct: number | null };

function numOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBands(value: unknown): Band[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return { maxThicknessMm: numOrNull(record.maxThicknessMm), pricePerKg: numOrNull(record.pricePerKg) };
  });
}

function toFormats(value: unknown): Format[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return { lengthMm: numOrNull(record.lengthMm), widthMm: numOrNull(record.widthMm) };
  });
}

function toMargins(value: unknown): Margin[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([customerClass, pct]) => ({
    customerClass,
    marginPct: numOrNull(pct),
  }));
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClick}>
      {label}
    </button>
  );
}

export function PriceBandsEditor({ rows, onChange }: { rows: Band[]; onChange: (rows: Band[]) => void }) {
  const c = useContent();
  const t = c.admin.rates.json;
  const update = (index: number, patch: Partial<Band>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-3">
      <Table dense>
        <thead>
          <tr>
            <Th align="num">{t.bands.maxThickness}</Th>
            <Th align="num">{t.bands.pricePerKg}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="row-muted">
              <Td colSpan={3}>{t.empty}</Td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={index}>
              <Td align="num">
                <NumberInput
                  dense
                  aria-label={t.bands.maxThickness}
                  value={row.maxThicknessMm}
                  onValueChange={(v) => update(index, { maxThicknessMm: v })}
                  decimals={3}
                  min={0}
                />
              </Td>
              <Td align="num">
                <NumberInput
                  dense
                  aria-label={t.bands.pricePerKg}
                  value={row.pricePerKg}
                  onValueChange={(v) => update(index, { pricePerKg: v })}
                  decimals={4}
                  min={0}
                />
              </Td>
              <Td>
                <RemoveButton label={t.remove} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...rows, { maxThicknessMm: null, pricePerKg: null }])}
        >
          {t.add}
        </button>
      </div>
    </div>
  );
}

export function SheetFormatsEditor({ rows, onChange }: { rows: Format[]; onChange: (rows: Format[]) => void }) {
  const c = useContent();
  const t = c.admin.rates.json;
  const update = (index: number, patch: Partial<Format>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-3">
      <Table dense>
        <thead>
          <tr>
            <Th align="num">{t.formats.length}</Th>
            <Th align="num">{t.formats.width}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="row-muted">
              <Td colSpan={3}>{t.empty}</Td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={index}>
              <Td align="num">
                <NumberInput
                  dense
                  aria-label={t.formats.length}
                  value={row.lengthMm}
                  onValueChange={(v) => update(index, { lengthMm: v })}
                  decimals={0}
                  min={0}
                />
              </Td>
              <Td align="num">
                <NumberInput
                  dense
                  aria-label={t.formats.width}
                  value={row.widthMm}
                  onValueChange={(v) => update(index, { widthMm: v })}
                  decimals={0}
                  min={0}
                />
              </Td>
              <Td>
                <RemoveButton label={t.remove} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...rows, { lengthMm: null, widthMm: null }])}
        >
          {t.add}
        </button>
      </div>
    </div>
  );
}

export function MarginByClassEditor({ rows, onChange }: { rows: Margin[]; onChange: (rows: Margin[]) => void }) {
  const c = useContent();
  const t = c.admin.rates.json;
  const update = (index: number, patch: Partial<Margin>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-3">
      <Table dense>
        <thead>
          <tr>
            <Th>{t.margins.customerClass}</Th>
            <Th align="num">{t.margins.marginPct}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="row-muted">
              <Td colSpan={3}>{t.empty}</Td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={index}>
              <Td>
                <Input
                  dense
                  aria-label={t.margins.customerClass}
                  value={row.customerClass}
                  placeholder={t.margins.classPlaceholder}
                  onChange={(event) => update(index, { customerClass: event.target.value })}
                  maxLength={40}
                />
              </Td>
              <Td align="num">
                <NumberInput
                  dense
                  aria-label={t.margins.marginPct}
                  value={row.marginPct}
                  onValueChange={(v) => update(index, { marginPct: v })}
                  decimals={2}
                  min={0}
                />
              </Td>
              <Td>
                <RemoveButton label={t.remove} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...rows, { customerClass: "", marginPct: null }])}
        >
          {t.add}
        </button>
      </div>
    </div>
  );
}

export type JsonCellModalProps = {
  column: ColumnDef;
  value: unknown;
  open: boolean;
  onClose: () => void;
  onApply: (value: unknown) => void;
};

/** Modal around the editor matching column.jsonKind; validates on Apply. */
export function JsonCellModal({ column, value, open, onClose, onApply }: JsonCellModalProps) {
  const c = useContent();
  const t = c.admin.rates.json;
  const [bands, setBands] = useState<Band[]>(() => toBands(value));
  const [formats, setFormats] = useState<Format[]>(() => toFormats(value));
  const [margins, setMargins] = useState<Margin[]>(() => toMargins(value));
  const [error, setError] = useState<string | null>(null);

  const title =
    column.jsonKind === "priceBands" ? t.bands.title : column.jsonKind === "sheetFormats" ? t.formats.title : t.margins.title;

  const apply = () => {
    let candidate: unknown;
    let ok: boolean;
    if (column.jsonKind === "priceBands") {
      candidate = [...bands].sort((a, b) => (a.maxThicknessMm ?? 0) - (b.maxThicknessMm ?? 0));
      ok = priceBandsSchema.safeParse(candidate).success;
    } else if (column.jsonKind === "sheetFormats") {
      candidate = formats;
      ok = sheetFormatsSchema.safeParse(candidate).success;
    } else {
      const record: Record<string, unknown> = {};
      for (const row of margins) record[row.customerClass.trim()] = row.marginPct;
      candidate = record;
      ok = margins.every((row) => row.customerClass.trim() !== "") && marginByClassSchema.safeParse(record).success;
    }
    if (!ok) {
      setError(c.admin.rates.errors.invalidJson);
      return;
    }
    onApply(candidate);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
            {t.apply}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {column.jsonKind === "priceBands" && <PriceBandsEditor rows={bands} onChange={setBands} />}
        {column.jsonKind === "sheetFormats" && <SheetFormatsEditor rows={formats} onChange={setFormats} />}
        {column.jsonKind === "marginByClass" && <MarginByClassEditor rows={margins} onChange={setMargins} />}
      </div>
    </Modal>
  );
}
