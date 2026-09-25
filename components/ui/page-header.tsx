/**
 * PageHeader — eyebrow + Archivo wdth-125 page title + subtitle, with an
 * actions slot on the right. Every app page starts with one.
 * File path: /components/ui/page-header.tsx
 *
 * Server-safe. Uses .page-title / .page-sub from globals.css and the
 * Eyebrow primitive so the STRETCH pattern (rule + tracked label) holds.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

export type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  /** Optional two-digit number before the eyebrow label. */
  eyebrowNumber?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  eyebrowNumber,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={`mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 ${className}`.trim()}
    >
      <div className="min-w-0">
        {eyebrow && <Eyebrow number={eyebrowNumber}>{eyebrow}</Eyebrow>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
