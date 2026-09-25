"use client";

/**
 * Pagination — previous / "page X of Y" / next, hard-edged ghost buttons.
 * File path: /components/ui/pagination.tsx
 *
 * Two modes: `onChange(page)` for client-side state, or `href` (+ optional
 * `pageParam`, default "page") for server-rendered lists — then the
 * buttons are links (`?page=n` appended to `href`), which keeps server
 * components free of function props. Renders nothing for a single page.
 */

import Link from "next/link";
import { useContent } from "@/components/providers/locale";
import { interpolate } from "@/components/ui/format";

export type PaginationProps = {
  page: number;
  pageCount: number;
  onChange?: (page: number) => void;
  /** Base URL (may already carry a query string) for link mode. */
  href?: string;
  pageParam?: string;
  className?: string;
};

function withPage(href: string, param: string, page: number): string {
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  if (page <= 1) search.delete(param);
  else search.set(param, String(page));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function Pagination({
  page,
  pageCount,
  onChange,
  href,
  pageParam = "page",
  className = "",
}: PaginationProps) {
  const c = useContent();
  if (pageCount <= 1) return null;
  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;
  const t = c.common.ui.pagination;

  const control = (target: number, label: string, disabled: boolean) => {
    if (href && !disabled) {
      return (
        <Link href={withPage(href, pageParam, target)} className="btn btn-ghost btn-sm">
          {label}
        </Link>
      );
    }
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange?.(target)}
        className="btn btn-ghost btn-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
      </button>
    );
  };

  return (
    <nav
      aria-label={t.label}
      className={`flex flex-wrap items-center justify-between gap-3 ${className}`.trim()}
    >
      {control(page - 1, t.prev, prevDisabled)}
      <span className="num text-[12px] font-bold tracking-[0.12em] text-text-muted uppercase">
        {interpolate(t.pageOf, { page, pageCount })}
      </span>
      {control(page + 1, t.next, nextDisabled)}
    </nav>
  );
}
