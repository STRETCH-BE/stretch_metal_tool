"use server";

/**
 * Customer server actions — create, update (sales + admin), delete (admin).
 * File path: /lib/customers/actions.ts
 *
 * Writes go through the RLS client as the user (customers_insert /
 * customers_update policies allow sales + admin, delete is admin only) and
 * the role is additionally checked here so a viewer gets a clean
 * "forbidden" state instead of an RLS error. Every change is audit-logged
 * (customer.create / customer.update / customer.delete) with before/after
 * snapshots, and the list + detail routes are revalidated.
 *
 * create/update are useActionState reducers: (prevState, formData) →
 * CustomerFormState with error CODES (mapped to copy in the client form).
 * Every error state carries `values` (the raw submitted strings): React 19
 * resets the <form> after the action settles, so the form re-populates
 * its defaultValues from them and a typo in one field never wipes the
 * rest (test/ui/customer-actions.test.ts).
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole, WRITE_ROLES, ADMIN_ONLY } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { routes } from "@/lib/routes";
import type { CustomerRow, Json } from "@/lib/db/types";
import {
  parseCustomerForm,
  readCustomerFormValues,
  type CustomerErrorCode,
  type CustomerFormState,
  type CustomerFormValues,
} from "@/lib/customers/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asJson(row: CustomerRow | null): Json | null {
  return row ? (JSON.parse(JSON.stringify(row)) as Json) : null;
}

function fail(values: CustomerFormValues, error: CustomerErrorCode): CustomerFormState {
  return { status: "error", error, values };
}

function revalidateCustomer(id?: string) {
  revalidatePath(routes.customers);
  if (id) revalidatePath(routes.customer(id));
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const values = readCustomerFormValues(formData);
  const session = await getCurrentUser();
  if (!session) redirect(routes.login);
  if (!hasRole(session, WRITE_ROLES)) return fail(values, "forbidden");

  const parsed = parseCustomerForm(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors, values };

  let created: CustomerRow | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .insert({ ...parsed.data, created_by: session.user.id })
      .select("*")
      .single();
    if (error) {
      console.error("[customers] create failed", error);
      return fail(values, "generic");
    }
    created = data;
  } catch (error) {
    console.error("[customers] create failed", error);
    return fail(values, "generic");
  }

  await logAudit({
    actor: session.user.id,
    action: "customer.create",
    entity: "customers",
    entityId: created.id,
    after: asJson(created),
  });
  revalidateCustomer(created.id);
  redirect(`${routes.customer(created.id)}?created=1`);
}

export async function updateCustomer(
  id: string,
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const values = readCustomerFormValues(formData);
  const session = await getCurrentUser();
  if (!session) redirect(routes.login);
  if (!hasRole(session, WRITE_ROLES)) return fail(values, "forbidden");
  if (!UUID.test(id)) return fail(values, "notFound");

  const parsed = parseCustomerForm(formData);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors, values };

  let before: CustomerRow | null = null;
  let after: CustomerRow | null = null;
  try {
    const supabase = await createClient();
    const existing = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
    if (existing.error) {
      console.error("[customers] read before update failed", existing.error);
      return fail(values, "generic");
    }
    if (!existing.data) return fail(values, "notFound");
    before = existing.data;

    const { data, error } = await supabase
      .from("customers")
      .update(parsed.data)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.error("[customers] update failed", error);
      return fail(values, "generic");
    }
    after = data;
  } catch (error) {
    console.error("[customers] update failed", error);
    return fail(values, "generic");
  }

  await logAudit({
    actor: session.user.id,
    action: "customer.update",
    entity: "customers",
    entityId: id,
    before: asJson(before),
    after: asJson(after),
  });
  revalidateCustomer(id);
  return { status: "saved", customer: after };
}

/** Admin only. Quotes keep their rows (customer_id → null via FK on delete set null). */
export async function deleteCustomer(id: string): Promise<void> {
  const session = await getCurrentUser();
  if (!session) redirect(routes.login);
  if (!hasRole(session, ADMIN_ONLY)) redirect(routes.forbidden);
  if (!UUID.test(id)) redirect(routes.customers);

  const supabase = await createClient();
  const existing = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (existing.error || !existing.data) redirect(routes.customers);

  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) {
    console.error("[customers] delete failed", error);
    redirect(`${routes.customer(id)}?error=delete`);
  }

  await logAudit({
    actor: session.user.id,
    action: "customer.delete",
    entity: "customers",
    entityId: id,
    before: asJson(existing.data),
  });
  revalidateCustomer(id);
  redirect(`${routes.customers}?deleted=1`);
}
