"use client";

/**
 * QuotePartsTable — the items of a quote: thumbnail, name (link to the
 * part page), material/thickness, editable qty, unit cost, unit price,
 * batch, flag chips; per row an expandable operation breakdown (driver
 * qty + unit, rate ref, unit cost, setup share, batch cost), the extras
 * modal, remove and reorder. Parts of the quote without an item are
 * listed below with "add to quote".
 * File path: /components/quote/quote-parts-table.tsx
 *
 * Numbers come from the `priced` prop (server snapshot or the local
 * preview) — this component never prices anything itself. Qty edits go
 * to onQtyChange immediately (preview) and to onSaveItem on blur/Enter
 * (server). Thumbnails use parts.thumbnail_svg and fall back to an SVG
 * built from the stored geometry (geometryToSvg) when the intake did not
 * store one.
 */

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useContent } from "@/components/providers/locale";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { NumberInput } from "@/components/ui/number-input";
import { PlaceholderBadge } from "@/components/ui/placeholder-badge";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { PartThumbnail } from "@/components/viewer/part-thumbnail";
import { geometryToSvg } from "@/lib/geometry/svg";
import { formatNumber, interpolate } from "@/lib/format";
import type { ExtraOperation, OperationLine, PricedItem, PricedQuote, RateSnapshot } from "@/lib/pricing/types";
import type { OperationLabelCode, DriverUnitCode } from "@/content/quote";
import { routes } from "@/lib/routes";
import { parseAnnotations, parseGeometry, type ItemUpdateInput } from "@/lib/quotes/schema";
import type { QuoteBundle } from "@/lib/quotes/types";
import type { PartRow, QuoteItemRow } from "@/lib/db/types";
import { FlagChip } from "./flag-message";
import { ExtrasEditor } from "./extras-editor";
import type { MoneyFormatter } from "./money";
import type { QuoteDraft } from "./preview";

export type QuotePartsTableProps = {
  bundle: QuoteBundle;
  priced: PricedQuote | null;
  draft: QuoteDraft;
  rates: RateSnapshot | null;
  editable: boolean;
  pending: boolean;
  money: MoneyFormatter;
  onQtyChange: (itemId: string, qty: number | null) => void;
  onExtrasChange: (itemId: string, extras: ExtraOperation[]) => void;
  onSaveItem: (itemId: string, input: ItemUpdateInput) => void;
  onRemoveItem: (itemId: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => void;
  onAddItem: (partId: string) => void;
};

function thumbnailFor(part: PartRow): string | null {
  if (part.thumbnail_svg) return part.thumbnail_svg;
  const geometry = parseGeometry(part.geometry);
  if (!geometry || geometry.entities.length === 0) return null;
  return geometryToSvg(geometry, parseAnnotations(part.annotations), { theme: "dark", width: 64, height: 64, padding: 4 });
}

export function QuotePartsTable({
  bundle,
  priced,
  draft,
  rates,
  editable,
  pending,
  money,
  onQtyChange,
  onExtrasChange,
  onSaveItem,
  onRemoveItem,
  onReorder,
  onAddItem,
}: QuotePartsTableProps) {
  const c = useContent();
  const t = c.quote.builder.parts;
  const ops = c.quote.builder.operations;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [extrasFor, setExtrasFor] = useState<QuoteItemRow | null>(null);

  const partsById = useMemo(() => new Map(bundle.parts.map((p) => [p.id, p])), [bundle.parts]);
  const pricedById = useMemo(() => new Map<string, PricedItem>((priced?.items ?? []).map((i) => [i.itemId, i])), [priced]);
  const thumbnails = useMemo(() => new Map(bundle.parts.map((p) => [p.id, thumbnailFor(p)])), [bundle.parts]);
  const attached = new Set(bundle.items.map((i) => i.part_id));
  const unattached = bundle.parts.filter((p) => !attached.has(p.id));
  const orderedIds = bundle.items.map((i) => i.id);

  const move = (index: number, delta: number) => {
    const next = [...orderedIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  const labelOf = (line: OperationLine): string =>
    (ops.labels as Record<string, string>)[line.label as OperationLabelCode] ?? line.label;
  const unitOf = (line: OperationLine): string => ops.units[line.driverUnit as DriverUnitCode] ?? line.driverUnit;

  return (
    <>
      <TableWrap>
        <Table dense>
          <thead>
            <tr>
              <Th>{t.columns.thumbnail}</Th>
              <Th>{t.columns.name}</Th>
              <Th>{t.columns.material}</Th>
              <Th align="num">{t.columns.qty}</Th>
              <Th align="num">{t.columns.unitCost}</Th>
              <Th align="num">{t.columns.unitPrice}</Th>
              <Th align="num">{t.columns.batch}</Th>
              <Th>{t.columns.flags}</Th>
              <Th>{c.common.table.actions}</Th>
            </tr>
          </thead>
          <tbody>
            {bundle.items.length === 0 && (
              <tr className="row-muted">
                <Td colSpan={9} className="py-8 text-center">
                  {t.empty}
                </Td>
              </tr>
            )}
            {bundle.items.map((item, index) => {
              const part = partsById.get(item.part_id);
              const line = pricedById.get(item.id) ?? null;
              const qty = draft.qtyById[item.id] ?? Number(item.qty);
              const expanded = Boolean(open[item.id]);
              const extrasCount = (draft.extrasById[item.id] ?? []).length;
              const thickness = part?.thickness_mm != null ? Number(part.thickness_mm) : null;
              return (
                <Fragment key={item.id}>
                  <tr>
                    <Td>
                      <PartThumbnail
                        svg={part ? thumbnails.get(part.id) : null}
                        size={48}
                        label={interpolate(t.thumbnailAlt, { name: part?.name ?? "" })}
                      />
                    </Td>
                    <Td>
                      {part ? (
                        <Link href={routes.part(part.id)} className="lnk font-bold">
                          {part.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {part && !part.geometry && <div className="text-[11px] text-text-faint">{t.noGeometry}</div>}
                      {extrasCount > 0 && (
                        <div className="text-[11px] text-text-faint">{interpolate(c.quote.builder.extras.summary, { count: extrasCount })}</div>
                      )}
                    </Td>
                    <Td>
                      <span className="mono">{part?.material_code ?? "—"}</span>
                      {thickness !== null && Number.isFinite(thickness) && (
                        <span className="ml-2 text-text-muted">
                          {formatNumber(thickness, c.locale)} {c.common.units.mm}
                        </span>
                      )}
                    </Td>
                    <Td align="num">
                      {editable ? (
                        <NumberInput
                          aria-label={t.columns.qty}
                          value={qty}
                          decimals={0}
                          min={1}
                          dense
                          inline
                          className="w-[84px]"
                          onValueChange={(value) => onQtyChange(item.id, value)}
                          onBlur={() => {
                            const value = draft.qtyById[item.id];
                            if (value && value !== Number(item.qty)) onSaveItem(item.id, { qty: value });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        formatNumber(qty, c.locale)
                      )}
                    </Td>
                    <Td align="num" className="money" muted={!line}>
                      {line ? money(line.unitCost) : "—"}
                    </Td>
                    <Td align="num" className="money font-bold" muted={!line}>
                      {line ? money(line.unitPrice) : "—"}
                    </Td>
                    <Td align="num" className="money" muted={!line}>
                      {line ? money(line.batchPrice) : "—"}
                    </Td>
                    <Td>
                      <span className="inline-flex max-w-[260px] flex-wrap gap-1">
                        {(line?.flags ?? []).map((flag, i) => (
                          <FlagChip key={`${flag.code}-${i}`} content={c} flag={flag} />
                        ))}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-expanded={expanded}
                          aria-controls={`ops-${item.id}`}
                          onClick={() => setOpen((s) => ({ ...s, [item.id]: !expanded }))}
                        >
                          {expanded ? t.hideBreakdown : t.breakdown}
                        </button>
                        {editable && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setExtrasFor(item)}>
                              {t.extras}
                            </button>
                            <button
                              type="button"
                              className="tool-btn"
                              aria-label={t.moveUp}
                              title={t.moveUp}
                              disabled={pending || index === 0}
                              onClick={() => move(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="tool-btn"
                              aria-label={t.moveDown}
                              title={t.moveDown}
                              disabled={pending || index === bundle.items.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              ↓
                            </button>
                            <ConfirmButton action={() => onRemoveItem(item.id)} question={t.removeConfirm} disabled={pending}>
                              {t.remove}
                            </ConfirmButton>
                          </>
                        )}
                      </span>
                    </Td>
                  </tr>
                  {expanded && (
                    <tr id={`ops-${item.id}`}>
                      <Td colSpan={9} className="bg-surface p-0">
                        <div className="px-4 py-3">
                          <div className="panel-title mb-2">{ops.title}</div>
                          {line && line.operations.length > 0 ? (
                            <Table dense>
                              <thead>
                                <tr>
                                  <Th>{ops.columns.operation}</Th>
                                  <Th align="num">{ops.columns.driver}</Th>
                                  <Th>{ops.columns.rate}</Th>
                                  <Th align="num">{ops.columns.unitCost}</Th>
                                  <Th align="num">{ops.columns.setupShare}</Th>
                                  <Th align="num">{ops.columns.batchCost}</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {line.operations.map((op) => (
                                  <tr key={op.id}>
                                    <Td>
                                      <span className="font-semibold">{labelOf(op)}</span>
                                      <span className="ml-2 text-[11px] text-text-faint uppercase">{ops.types[op.type]}</span>
                                      {!op.auto && <StatusChip severity="neutral" plain label={ops.manual} className="ml-2" />}
                                    </Td>
                                    <Td align="num">
                                      {formatNumber(op.driverQty, c.locale, { maximumFractionDigits: 3 })} {unitOf(op)}
                                    </Td>
                                    <Td>
                                      <span className="mono text-[12px] text-text-muted">
                                        {op.rateRef.table}:{op.rateRef.key}
                                      </span>
                                      {op.rateRef.values.placeholder === true && <PlaceholderBadge className="ml-2" />}
                                    </Td>
                                    <Td align="num" className="money">
                                      {money(op.unitCost)}
                                    </Td>
                                    <Td align="num" className="money" muted={op.setupShare === 0}>
                                      {op.setupShare ? money(op.setupShare) : "—"}
                                    </Td>
                                    <Td align="num" className="money">
                                      {money(op.unitCost * line.qty)}
                                    </Td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          ) : (
                            <p className="text-[13px] text-text-muted">{c.quote.builder.totals.notPriced}</p>
                          )}
                        </div>
                      </Td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      {unattached.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="panel-title mb-2">{t.unattached}</div>
          <ul className="flex flex-col gap-2">
            {unattached.map((part) => (
              <li key={part.id} className="flex flex-wrap items-center gap-3">
                <PartThumbnail svg={thumbnails.get(part.id)} size={36} label={interpolate(t.thumbnailAlt, { name: part.name })} />
                <Link href={routes.part(part.id)} className="lnk font-bold">
                  {part.name}
                </Link>
                {editable && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onAddItem(part.id)}>
                    {t.addToQuote}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {extrasFor && (
        <ExtrasEditor
          open
          item={extrasFor}
          partName={partsById.get(extrasFor.part_id)?.name ?? ""}
          extras={draft.extrasById[extrasFor.id] ?? []}
          scrapPct={extrasFor.id in draft.scrapById ? draft.scrapById[extrasFor.id] : null}
          rates={rates}
          pending={pending}
          onChange={(extras) => onExtrasChange(extrasFor.id, extras)}
          onSave={(extras, scrapPct) => {
            onSaveItem(extrasFor.id, { extras, scrapPct });
            setExtrasFor(null);
          }}
          onClose={() => setExtrasFor(null)}
        />
      )}
    </>
  );
}
