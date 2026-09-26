/**
 * Audit log viewer — paginated table with filters (entity, action
 * prefix, actor, date range) and expandable before/after JSON.
 * File path: /app/(app)/admin/audit/page.tsx
 *
 * Filters are GET params; pagination links keep them.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { interpolate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { listAuditActors, listAuditEntities, listAuditLog } from "@/lib/admin/audit";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { AuditTable } from "@/components/admin/audit-table";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.audit.title };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.audit;

  const filters = {
    entity: first(params.entity).trim(),
    actionPrefix: first(params.action).trim(),
    actor: first(params.actor).trim(),
    from: first(params.from).trim(),
    to: first(params.to).trim(),
    page: Math.max(1, Number.parseInt(first(params.page), 10) || 1),
  };

  const supabase = await createClient();
  const [result, entities, actors] = await Promise.all([
    listAuditLog(supabase, filters),
    listAuditEntities(supabase),
    listAuditActors(supabase),
  ]);

  const query = new URLSearchParams();
  if (filters.entity) query.set("entity", filters.entity);
  if (filters.actionPrefix) query.set("action", filters.actionPrefix);
  if (filters.actor) query.set("actor", filters.actor);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  const qs = query.toString();
  const listHref = qs ? `${routes.adminAudit}?${qs}` : routes.adminAudit;
  const filtered = Boolean(qs);

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <Panel className="mb-6">
        <form method="get" action={routes.adminAudit} className="grid gap-3 md:grid-cols-6">
          <div>
            <label htmlFor="audit-entity" className="field-label">
              {t.filters.entity}
            </label>
            <select id="audit-entity" name="entity" defaultValue={filters.entity} className="field field-sm">
              <option value="">{t.filters.anyEntity}</option>
              {entities.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-action" className="field-label">
              {t.filters.action}
            </label>
            <input
              id="audit-action"
              name="action"
              type="text"
              defaultValue={filters.actionPrefix}
              placeholder={t.filters.actionPlaceholder}
              className="field field-sm mono"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="audit-actor" className="field-label">
              {t.filters.actor}
            </label>
            <select id="audit-actor" name="actor" defaultValue={filters.actor} className="field field-sm">
              <option value="">{t.filters.anyActor}</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.full_name?.trim() || actor.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-from" className="field-label">
              {t.filters.from}
            </label>
            <input id="audit-from" name="from" type="date" defaultValue={filters.from} className="field field-sm" />
          </div>
          <div>
            <label htmlFor="audit-to" className="field-label">
              {t.filters.to}
            </label>
            <input id="audit-to" name="to" type="date" defaultValue={filters.to} className="field field-sm" />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-primary btn-sm">
              {t.filters.apply}
            </button>
            {filtered && (
              <Link href={routes.adminAudit} className="btn btn-ghost btn-sm">
                {t.filters.reset}
              </Link>
            )}
          </div>
        </form>
      </Panel>

      <Panel flush title={interpolate(t.results, { count: result.total })}>
        <AuditTable rows={result.rows} content={c} locale={locale} />
        {result.pageCount > 1 && (
          <div className="px-4 py-3">
            <Pagination page={result.page} pageCount={result.pageCount} href={listHref} />
          </div>
        )}
      </Panel>
    </>
  );
}
