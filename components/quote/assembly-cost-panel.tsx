"use client";

/**
 * AssemblyCostPanel — the live cost / margin / price block of one welded
 * assembly. Admins see the full breakdown per assembly piece: parts at
 * cost, labour minutes by kind (fit-up, tacks, welding, gas + wire,
 * deburr, handling, forming) with EUR, job setups (once per job, spread
 * over the quantity), subcontracting, unit cost, applied margin, unit
 * price and total. Everyone else sees only the unit price and the total.
 * File path: /components/quote/assembly-cost-panel.tsx
 *
 * Numbers come from PricedAssembly (server snapshot or the local
 * preview) grouped by components/quote/assembly-view.ts — nothing is
 * priced here. `unitPrice === null` = unpriceable (an unresolved forming
 * operation, a refused member) and the panel says so.
 */

import { useContent } from "@/components/providers/locale";
import { formatNumber, formatPercent, interpolate } from "@/lib/format";
import type { PricedAssembly } from "@/lib/pricing/types";
import type { OperationLabelCode } from "@/content/quote";
import { groupAssemblyCosts } from "./assembly-view";
import type { MoneyFormatter } from "./money";

export type AssemblyCostPanelProps = {
  priced: PricedAssembly | null;
  qty: number;
  isAdmin: boolean;
  money: MoneyFormatter;
  /** True when the numbers are a local preview (labelled by the builder). */
  preview?: boolean;
};

export function AssemblyCostPanel({ priced, qty, isAdmin, money }: AssemblyCostPanelProps) {
  const c = useContent();
  const t = c.quote.builder.assembly.cost;
  const p = c.quote.builder.assembly.price;
  const labels = c.quote.builder.operations.labels as Record<string, string>;
  const fmt = (n: number, digits = 1) => formatNumber(n, c.locale, { maximumFractionDigits: digits });

  if (!priced) return <p className="text-[13px] text-text-muted">{t.notPriced}</p>;

  const total = priced.batchPrice;
  const priceBlock = (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
      <dt className="text-text-muted">{p.unitPrice}</dt>
      <dd className={`num money font-bold ${priced.unitPrice === null ? "text-text-faint" : "text-[15px]"}`}>{priced.unitPrice === null ? "—" : money(priced.unitPrice)}</dd>
      <dt className="text-text-muted">
        {p.total} <span className="text-text-faint">({interpolate(p.qty, { qty: formatNumber(qty, c.locale) })})</span>
      </dt>
      <dd className="num money font-bold">{total === null ? "—" : money(total)}</dd>
    </dl>
  );

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-2">
        {priceBlock}
        {priced.unitPrice === null && <p className="text-[12px] font-bold text-red">{t.unpriceable}</p>}
      </div>
    );
  }

  const groups = groupAssemblyCosts(priced);
  const kinds = t.labourKinds;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] text-text-faint">{t.adminOnly}</p>
      <table className="tbl tbl-dense w-full">
        <thead>
          <tr>
            <th>{t.columns.line}</th>
            <th className="num">{t.columns.minutes}</th>
            <th className="num">{t.columns.amount}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-semibold">{t.partsAtCost}</td>
            <td className="num text-text-faint">—</td>
            <td className="num money">{money(groups.partsEur)}</td>
          </tr>
          {groups.partsAtCost.map((line) => (
            <tr key={line.id} className="row-muted">
              <td className="pl-5">{typeof line.details.partName === "string" && line.details.partName ? line.details.partName : (labels[line.label as OperationLabelCode] ?? line.label)}</td>
              <td className="num">{fmt(line.driverQty, 0)}</td>
              <td className="num money">{money(line.unitCost)}</td>
            </tr>
          ))}
          <tr>
            <td className="font-semibold">{t.labour}</td>
            <td className="num">{fmt(priced.labour.totalMin)}</td>
            <td className="num money">{money(groups.labourEur)}</td>
          </tr>
          {groups.labour.map((row) => (
            <tr key={row.kind} className="row-muted">
              <td className="pl-5">{kinds[row.kind]}</td>
              <td className="num">{fmt(row.minutes)}</td>
              <td className="num money">{money(row.eur)}</td>
            </tr>
          ))}
          <tr>
            <td className="font-semibold">
              {t.setups} <span className="font-normal text-text-faint">{interpolate(t.setupsHelp, { qty: formatNumber(qty, c.locale) })}</span>
            </td>
            <td className="num text-text-faint">—</td>
            <td className="num money">{money(groups.setupsEur)}</td>
          </tr>
          {groups.setups.map((line) => (
            <tr key={line.id} className="row-muted">
              <td className="pl-5">{labels[line.label as OperationLabelCode] ?? line.label}</td>
              <td className="num text-text-faint">—</td>
              <td className="num money">{money(line.unitCost)}</td>
            </tr>
          ))}
          {groups.subcontract.length > 0 && (
            <tr>
              <td className="font-semibold">{t.subcontract}</td>
              <td className="num text-text-faint">—</td>
              <td className="num money">{money(groups.subcontractEur)}</td>
            </tr>
          )}
          {groups.subcontract.map((line) => (
            <tr key={line.id} className="row-muted">
              <td className="pl-5">{typeof line.details.supplier === "string" && line.details.supplier ? line.details.supplier : labels[line.label as OperationLabelCode] ?? line.label}</td>
              <td className="num text-text-faint">—</td>
              <td className="num money">{money(line.unitCost)}</td>
            </tr>
          ))}
          {groups.other.map((line) => (
            <tr key={line.id}>
              <td>{labels[line.label as OperationLabelCode] ?? line.label}</td>
              <td className="num">{typeof line.details.minutes === "number" ? fmt(line.details.minutes) : "—"}</td>
              <td className="num money">{money(line.unitCost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t.unitCost}</td>
            <td className="num">{fmt(priced.labour.totalMin)}</td>
            <td className="num money">{money(priced.unitCost)}</td>
          </tr>
          <tr>
            <td>{t.margin}</td>
            <td className="num text-text-faint">—</td>
            <td className="num">{formatPercent(priced.marginPct, c.locale)}</td>
          </tr>
          <tr>
            <td>{t.unitPrice}</td>
            <td className="num text-text-faint">—</td>
            <td className={`num money font-bold ${priced.unitPrice === null ? "text-text-faint" : "text-[15px]"}`}>{priced.unitPrice === null ? "—" : money(priced.unitPrice)}</td>
          </tr>
          <tr>
            <td>
              {t.total} <span className="text-text-faint">({interpolate(p.qty, { qty: formatNumber(qty, c.locale) })})</span>
            </td>
            <td className="num text-text-faint">—</td>
            <td className="num money font-bold">{total === null ? "—" : money(total)}</td>
          </tr>
        </tfoot>
      </table>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-text-muted">
        <dt>{t.arcMinutes}</dt>
        <dd className="num">
          {fmt(priced.labour.arcMin)} {c.common.units.min}
        </dd>
        <dt>{t.seamLength}</dt>
        <dd className="num">
          {fmt(priced.seamLengthMm, 0)} {c.common.units.mm}
        </dd>
      </dl>
      {priced.unitPrice === null && <p className="text-[12px] font-bold text-red">{t.unpriceable}</p>}
    </div>
  );
}
