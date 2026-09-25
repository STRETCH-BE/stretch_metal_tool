/**
 * New customer page.
 * File path: /app/(app)/customers/new/page.tsx
 *
 * Sales + admin only (viewers are sent to /forbidden). The form posts the
 * createCustomer server action, which redirects to the new customer's
 * page with ?created=1.
 */

import type { Metadata } from "next";
import { requireRole, WRITE_ROLES } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { createCustomer } from "@/lib/customers/actions";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { CustomerForm } from "@/components/customers/customer-form";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getLocale());
  return { title: c.quote.customers.newTitle };
}

export default async function NewCustomerPage() {
  await requireRole(WRITE_ROLES);
  const c = getContent(await getLocale());
  const t = c.quote.customers;
  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.newTitle} subtitle={t.newSubtitle} />
      <Panel className="max-w-[880px]">
        <CustomerForm mode="create" action={createCustomer} />
      </Panel>
    </>
  );
}
