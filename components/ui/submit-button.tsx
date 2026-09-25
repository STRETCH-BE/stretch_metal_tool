"use client";

/**
 * SubmitButton — form submit that reflects useFormStatus(): disabled and
 * labelled "Saving…" (or `pendingLabel`) while the server action runs.
 * File path: /components/ui/submit-button.tsx
 *
 * Must be rendered INSIDE the <form> whose status it reports.
 */

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { useContent } from "@/components/providers/locale";
import { Spinner } from "@/components/ui/spinner";

export type SubmitButtonProps = {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "ghost" | "ghost-light";
  size?: "sm" | "md" | "lg";
  arrow?: boolean;
  disabled?: boolean;
  className?: string;
  /** Alternate server action for a secondary submit (formAction). */
  formAction?: (formData: FormData) => void | Promise<void>;
  formNoValidate?: boolean;
  name?: string;
  value?: string;
};

const VARIANT = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  "ghost-light": "btn-ghost-light",
} as const;
const SIZE = { sm: "btn-sm", md: "", lg: "btn-lg" } as const;

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  arrow = false,
  disabled,
  className = "",
  formAction,
  formNoValidate,
  name,
  value,
}: SubmitButtonProps) {
  const c = useContent();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending ? "true" : undefined}
      formAction={formAction}
      formNoValidate={formNoValidate}
      name={name}
      value={value}
      className={`btn ${VARIANT[variant]} ${SIZE[size]} disabled:cursor-not-allowed disabled:opacity-60 ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? c.common.actions.saving}
        </>
      ) : (
        <>
          {children}
          {arrow && (
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          )}
        </>
      )}
    </button>
  );
}
