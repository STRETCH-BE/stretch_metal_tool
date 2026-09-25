/**
 * DataTable helpers — Table / Th / Td around the .tbl classes.
 * File path: /components/ui/table.tsx
 *
 * Server-safe. `align="num"` puts .num on the cell (right-aligned tabular
 * figures); `dense` → .tbl-dense; `stickyHead` → .tbl-sticky-head (works
 * inside a scroll container of bounded height). TableWrap gives
 * horizontal overflow for wide tables at 1024 px.
 */

import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

export type CellAlign = "left" | "num" | "center";

export type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  dense?: boolean;
  stickyHead?: boolean;
};

export function Table({
  dense = false,
  stickyHead = false,
  className = "",
  children,
  ...rest
}: TableProps) {
  return (
    <table
      className={`tbl ${dense ? "tbl-dense" : ""} ${stickyHead ? "tbl-sticky-head" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      {...rest}
    >
      {children}
    </table>
  );
}

export function TableWrap({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`w-full overflow-x-auto ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

function alignClass(align: CellAlign | undefined): string {
  if (align === "num") return "num";
  if (align === "center") return "text-center";
  return "";
}

export type ThProps = Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & {
  align?: CellAlign;
};

export function Th({ align, className = "", children, ...rest }: ThProps) {
  return (
    <th scope="col" className={`${alignClass(align)} ${className}`.trim()} {...rest}>
      {children}
    </th>
  );
}

export type TdProps = Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> & {
  align?: CellAlign;
  /** Faint text (secondary values). */
  muted?: boolean;
};

export function Td({ align, muted = false, className = "", children, ...rest }: TdProps) {
  return (
    <td
      className={`${alignClass(align)} ${muted ? "text-text-faint" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      {...rest}
    >
      {children}
    </td>
  );
}
