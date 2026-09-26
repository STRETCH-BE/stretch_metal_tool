"use client";

/**
 * UserRowForm — role + locale selects and Save for one profile row
 * (updateUserAction bound to the user id). Toasts the outcome; the
 * last-admin refusal shows inline.
 * File path: /components/admin/user-row-form.tsx
 */

import { useActionState, useEffect, useRef } from "react";
import { useContent } from "@/components/providers/locale";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import type { ProfileRow } from "@/lib/db/types";
import { INITIAL_USER_ROW_FORM_STATE, USER_LOCALES, USER_ROLES, type UserRowFormState } from "@/lib/admin/users";

export function UserRowForm({
  profile,
  action,
}: {
  profile: ProfileRow;
  action: (state: UserRowFormState, formData: FormData) => Promise<UserRowFormState>;
}) {
  const c = useContent();
  const t = c.admin.users.row;
  const { toast } = useToast();
  const [state, formAction] = useActionState(action, INITIAL_USER_ROW_FORM_STATE);
  const handled = useRef<UserRowFormState | null>(null);

  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "saved") toast(t.saved, { tone: "success" });
    if (state.status === "noChange") toast(t.noChange);
  }, [state, toast, t.saved, t.noChange]);

  const current = state.profile ?? profile;
  const errorText = state.status === "error" && state.error ? (state.error === "invalid" ? t.generic : t[state.error]) : null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`role-${profile.id}`} className="visually-hidden">
        {c.admin.users.columns.role}
      </label>
      <Select id={`role-${profile.id}`} name="role" dense inline defaultValue={current.role} key={`role-${current.role}`}>
        {USER_ROLES.map((role) => (
          <option key={role} value={role}>
            {c.common.roles[role]}
          </option>
        ))}
      </Select>
      <label htmlFor={`locale-${profile.id}`} className="visually-hidden">
        {c.admin.users.columns.locale}
      </label>
      <Select id={`locale-${profile.id}`} name="locale" dense inline defaultValue={current.locale} key={`locale-${current.locale}`}>
        {USER_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {c.common.locales[locale]}
          </option>
        ))}
      </Select>
      <SubmitButton size="sm" variant="ghost">
        {t.save}
      </SubmitButton>
      {errorText && (
        <span className="field-error basis-full" role="alert">
          {errorText}
        </span>
      )}
    </form>
  );
}
