/**
 * Users — profiles table (e-mail, name, role, locale, created) with a
 * role/locale form per row, plus the invite form.
 * File path: /app/(app)/admin/users/page.tsx
 *
 * Invites need the service-role key: the form is disabled with a notice
 * when env.hasSupabaseAdmin() is false.
 */

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listUsers } from "@/lib/admin/users";
import { updateUserAction } from "@/lib/admin/users-actions";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { UserRowForm } from "@/components/admin/user-row-form";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.admin.users.title };
}

export default async function UsersPage() {
  const session = await requireRole(["admin"]);
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.users;
  const supabase = await createClient();
  const users = await listUsers(supabase);

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-6">
        <Panel flush title={t.title} actions={<StatusChip severity="neutral" plain label={String(users.length)} />}>
          <TableWrap>
            <Table dense>
              <thead>
                <tr>
                  <Th>{t.columns.email}</Th>
                  <Th>{t.columns.name}</Th>
                  <Th>{t.columns.role}</Th>
                  <Th>{t.columns.created}</Th>
                  <Th>{t.columns.actions}</Th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr className="row-muted">
                    <Td colSpan={5} className="py-8 text-center">
                      {t.empty}
                    </Td>
                  </tr>
                )}
                {users.map((user) => (
                  <tr key={user.id}>
                    <Td>
                      {user.email}
                      {user.id === session.user.id && (
                        <span className="ml-2 text-[11px] font-bold tracking-[0.1em] text-red uppercase">{t.you}</span>
                      )}
                    </Td>
                    <Td muted={!user.full_name}>{user.full_name ?? "—"}</Td>
                    <Td>
                      <StatusChip severity={user.role === "admin" ? "dark" : "neutral"} label={c.common.roles[user.role]} />
                    </Td>
                    <Td className="num">{formatDate(user.created_at, locale)}</Td>
                    <Td>
                      <UserRowForm profile={user} action={updateUserAction.bind(null, user.id)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>

        <Panel className="max-w-[860px]" title={t.invite.title}>
          <InviteUserForm enabled={env.hasSupabaseAdmin()} />
        </Panel>
      </div>
    </>
  );
}
