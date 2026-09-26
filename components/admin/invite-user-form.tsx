"use client";

/**
 * InviteUserForm — e-mail, full name, role, locale → inviteUserAction.
 * File path: /components/admin/invite-user-form.tsx
 *
 * Disabled (with the notice) when the service-role key is missing —
 * the page passes `enabled` from env.hasSupabaseAdmin(). Submitted values
 * are echoed back on error (React 19 form reset).
 */

import { useActionState } from "react";
import { useContent } from "@/components/providers/locale";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { interpolate } from "@/lib/format";
import { INITIAL_INVITE_FORM_STATE, USER_LOCALES, USER_ROLES } from "@/lib/admin/users";
import { inviteUserAction } from "@/lib/admin/users-actions";

export function InviteUserForm({ enabled }: { enabled: boolean }) {
  const c = useContent();
  const t = c.admin.users.invite;
  const [state, formAction] = useActionState(inviteUserAction, INITIAL_INVITE_FORM_STATE);
  const typed = state.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <p className="text-[13px] text-text-muted">{t.body}</p>
      {!enabled && <Notice tone="info">{t.notConfigured}</Notice>}
      {state.status === "error" && state.error && <Notice tone="error">{t.errors[state.error]}</Notice>}
      {state.status === "sent" && (
        <Notice tone="success">{interpolate(t.sent, { email: state.email ?? "" })}</Notice>
      )}
      <fieldset className="grid gap-4 md:grid-cols-2" disabled={!enabled}>
        <Field label={t.email} htmlFor="invite-email" requiredLabel={c.common.ui.required}>
          <Input id="invite-email" name="email" type="email" required maxLength={200} defaultValue={typed?.email ?? ""} autoComplete="off" />
        </Field>
        <Field label={t.fullName} htmlFor="invite-full_name">
          <Input id="invite-full_name" name="full_name" maxLength={160} defaultValue={typed?.full_name ?? ""} autoComplete="off" />
        </Field>
        <Field label={t.role} htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue={typed?.role ?? "sales"}>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {c.common.roles[role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.locale} htmlFor="invite-locale">
          <Select id="invite-locale" name="locale" defaultValue={typed?.locale ?? "pl"}>
            {USER_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {c.common.locales[locale]}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <div>
        <SubmitButton arrow disabled={!enabled}>
          {t.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
