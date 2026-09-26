/**
 * Quote upload page — dropzone + upload flow, results, quick part and
 * the quote's parts table.
 * File path: /app/(app)/quotes/[id]/upload/page.tsx
 *
 * Server component: loads the quote (RLS), decides whether the user may
 * write (admin, or the sales owner of a draft / pending-override quote
 * whose geometry is not locked — the same rule the actions and routes
 * enforce), the material options for the quick-part form and the parts
 * list. The client workspace refreshes this route after every upload.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale, interpolate } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { QUOTE_FILES_BUCKET } from "@/lib/env";
import { isUuid } from "@/lib/parts/schema";
import { isQuoteEditable } from "@/lib/parts/access";
import { listQuoteParts, loadRatesInfo } from "@/lib/parts/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { UploadWorkspace } from "@/components/intake/upload-workspace";
import { PartsTable } from "@/components/intake/parts-table";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const c = getContent(await getLocale());
  if (!isUuid(id)) return { title: c.upload.intake.eyebrow };
  const supabase = await createClient();
  const { data: quote } = await supabase.from("quotes").select("number").eq("id", id).maybeSingle();
  return { title: quote ? interpolate(c.upload.intake.title, { number: quote.number }) : c.upload.intake.eyebrow };
}

export default async function QuoteUploadPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const locale = await getLocale();
  const c = getContent(locale);
  const t = c.upload.intake;
  const session = await getCurrentUser();
  if (!session) notFound();
  const supabase = await createClient();
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`quotes select: ${error.message}`);
  if (!quote) notFound();

  const role = session.profile.role;
  const owner = role === "admin" || (role === "sales" && quote.created_by === session.user.id);
  const canWrite = owner && isQuoteEditable(quote);
  const [rates, parts] = await Promise.all([loadRatesInfo(supabase, quote.rate_version_id), listQuoteParts(supabase, id)]);
  const number = `${quote.number}${quote.version > 1 ? `-v${quote.version}` : ""}`;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={interpolate(t.title, { number })}
        subtitle={t.subtitle}
        actions={
          <Link href={routes.quote(id)} className="btn btn-primary btn-sm">
            {t.backToQuote}
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          </Link>
        }
      />
      <div className="flex flex-col gap-6">
        <UploadWorkspace
          quoteId={id}
          bucket={QUOTE_FILES_BUCKET}
          canWrite={canWrite}
          materials={rates.materials.map((m) => ({ code: m.code, name: m.name }))}
        />
        <Panel title={t.parts.title} flush>
          <PartsTable rows={parts} canWrite={canWrite} />
        </Panel>
      </div>
    </>
  );
}
