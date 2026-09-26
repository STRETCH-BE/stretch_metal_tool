/**
 * AdminCards — the admin index: one hard-edged card per section with its
 * headline number and a link.
 * File path: /components/admin/admin-cards.tsx
 */

import Link from "next/link";
import type { Content } from "@/content";
import { interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { AdminDashboard } from "@/lib/admin/dashboard";
import { StatusChip } from "@/components/ui/status-chip";

type Card = {
  key: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  metric?: string;
  chip?: { severity: "green" | "amber" | "red" | "neutral" | "placeholder"; label: string };
};

export function AdminCards({ dashboard, content }: { dashboard: AdminDashboard; content: Content }) {
  const t = content.admin.index.cards;
  const cards: Card[] = [
    {
      key: "rates",
      title: t.rates.title,
      body: t.rates.body,
      href: routes.adminRates,
      cta: t.rates.open,
      metric: dashboard.activeVersion ? interpolate(t.rates.active, { label: dashboard.activeVersion.label }) : t.rates.noActive,
      chip:
        dashboard.activePlaceholders > 0
          ? { severity: "placeholder", label: interpolate(t.rates.placeholders, { count: dashboard.activePlaceholders }) }
          : dashboard.activeVersion
            ? { severity: "green", label: content.admin.rates.versions.statusActive }
            : { severity: "red", label: content.admin.rates.errors.noActiveVersion },
    },
    {
      key: "machines",
      title: t.machines.title,
      body: t.machines.body,
      href: routes.adminMachines,
      cta: t.machines.open,
      metric: interpolate(t.machines.count, { count: dashboard.machineCount }),
    },
    {
      key: "overrides",
      title: t.overrides.title,
      body: t.overrides.body,
      href: routes.adminOverrides,
      cta: t.overrides.open,
      metric: interpolate(t.overrides.pending, { count: dashboard.pendingOverrides }),
      chip: dashboard.pendingOverrides > 0 ? { severity: "amber", label: content.admin.overrides.status.pending } : undefined,
    },
    {
      key: "users",
      title: t.users.title,
      body: t.users.body,
      href: routes.adminUsers,
      cta: t.users.open,
      metric: interpolate(t.users.count, { count: dashboard.userCount }),
    },
    { key: "calculator", title: t.calculator.title, body: t.calculator.body, href: routes.adminCalculator, cta: t.calculator.open },
    { key: "audit", title: t.audit.title, body: t.audit.body, href: routes.adminAudit, cta: t.audit.open },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <section key={card.key} className="panel flex flex-col">
          <div className="panel-head">
            <h2 className="panel-title">{card.title}</h2>
            {card.chip && <StatusChip severity={card.chip.severity} label={card.chip.label} />}
          </div>
          <div className="panel-body flex flex-1 flex-col gap-3">
            {card.metric && <p className="num text-[20px] font-bold tracking-[-0.01em]">{card.metric}</p>}
            <p className="flex-1 text-[13.5px] text-text-muted">{card.body}</p>
            <div>
              <Link href={card.href} className="btn btn-ghost btn-sm">
                {card.cta}
                <span aria-hidden="true" className="btn-arrow">
                  →
                </span>
              </Link>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
