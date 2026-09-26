"use client";

/**
 * OverrideDecisionForm — decision note + Approve / Reject submit buttons
 * for one pending override (decideOverrideAction).
 * File path: /components/admin/override-decision-form.tsx
 *
 * Both buttons submit the same form with name="decision" so the action
 * knows which was pressed. Rejection needs a note (the action refuses
 * otherwise). After a decision the row disappears on the next server
 * render (the action revalidates); until then a status notice shows.
 */

import { useActionState } from "react";
import { useContent } from "@/components/providers/locale";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { interpolate } from "@/lib/format";
import { decideOverrideAction } from "@/lib/admin/overrides-actions";
import { INITIAL_OVERRIDE_DECISION_STATE } from "@/lib/admin/overrides-types";

export function OverrideDecisionForm({ overrideId }: { overrideId: string }) {
  const c = useContent();
  const t = c.admin.overrides;
  const [state, formAction] = useActionState(decideOverrideAction, INITIAL_OVERRIDE_DECISION_STATE);

  if (state.status === "decided") {
    return (
      <Notice tone="success">
        {state.decision === "approve" ? t.decision.approved : t.decision.rejected}
        {state.quoteReverted ? ` ${t.decision.quoteReverted}` : ""}
      </Notice>
    );
  }

  return (
    <form action={formAction} className="flex min-w-[260px] flex-col gap-2">
      <input type="hidden" name="overrideId" value={overrideId} />
      {state.status === "error" && state.error && (
        <span className="field-error" role="alert">
          {interpolate(t.errors[state.error], { message: state.message ?? "" })}
        </span>
      )}
      <label htmlFor={`note-${overrideId}`} className="visually-hidden">
        {t.decision.note}
      </label>
      <Textarea
        id={`note-${overrideId}`}
        name="note"
        rows={2}
        dense
        maxLength={1000}
        placeholder={t.decision.notePlaceholder}
        defaultValue={state.note ?? ""}
      />
      <div className="flex gap-2">
        <SubmitButton size="sm" name="decision" value="approve">
          {t.decision.approve}
        </SubmitButton>
        <SubmitButton size="sm" variant="ghost" name="decision" value="reject">
          {t.decision.reject}
        </SubmitButton>
      </div>
    </form>
  );
}
