/**
 * SettingsFrame — the common chrome of every settings page: eyebrow +
 * page title + the table's one-line hint as subtitle, the settings
 * sub-navigation, the "run the migration" notice when the table is
 * missing, and the placeholder hint above the content.
 * File path: /components/admin/settings-frame.tsx
 *
 * Server-safe (no hooks): the pages pass the resolved content in. Only
 * the nav inside is a client component (needs the pathname).
 */

import type { ReactNode } from "react";
import type { Content } from "@/content";
import { interpolate } from "@/lib/format";
import { SETTINGS_DB_TABLES, type SettingsTable } from "@/lib/admin/settings-types";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsNav } from "@/components/admin/settings-nav";

export type SettingsFrameProps = {
  content: Content;
  /** The table page; omit for the overview. */
  table?: SettingsTable;
  title: string;
  hint: string;
  /** The table does not exist in this database (migration not applied). */
  missing?: boolean;
  /** Show the "placeholder rows — save to confirm" explanation. */
  placeholderHint?: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

export function SettingsFrame({ content, table, title, hint, missing = false, placeholderHint = false, actions, children }: SettingsFrameProps) {
  const t = content.admin.settings;
  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={title} subtitle={hint} actions={actions} />
      <SettingsNav />
      <div className="flex flex-col gap-6">
        {missing && (
          <Notice tone="error">{interpolate(t.migrationMissing, { table: table ? SETTINGS_DB_TABLES[table] : "" })}</Notice>
        )}
        {!missing && placeholderHint && <p className="text-[13px] text-text-muted">{t.placeholderHint}</p>}
        {!missing && children}
      </div>
    </>
  );
}
