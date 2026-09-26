/**
 * Machine editor — typed limits form per kind + raw JSON fallback.
 * File path: /app/(app)/admin/machines/[code]/page.tsx
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { getMachine } from "@/lib/admin/machines";
import { updateMachineAction } from "@/lib/admin/machines-actions";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { MachineForm } from "@/components/admin/machine-form";

type Params = Promise<{ code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  const c = getContent(await getLocale());
  return { title: `${decodeURIComponent(code)} — ${c.admin.machines.edit.eyebrow}` };
}

export default async function MachinePage({ params }: { params: Params }) {
  await requireRole(["admin"]);
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).slice(0, 80);
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.admin.machines;
  const supabase = await createClient();
  const machine = await getMachine(supabase, code);
  if (!machine) notFound();

  return (
    <>
      <PageHeader
        eyebrow={t.edit.eyebrow}
        title={machine.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span className="mono">{machine.code}</span>
            <StatusChip severity="neutral" plain label={t.kinds[machine.kind]} />
          </span>
        }
        actions={
          <Link href={routes.adminMachines} className="btn btn-ghost btn-sm">
            {t.edit.backToList}
          </Link>
        }
      />
      <Panel className="max-w-[960px]" title={t.edit.sectionLimits}>
        <MachineForm machine={machine} action={updateMachineAction.bind(null, machine.code)} />
      </Panel>
    </>
  );
}
