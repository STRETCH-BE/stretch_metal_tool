"use client";

/**
 * ConfirmButton — destructive/irreversible action with an inline confirm
 * step (no window.confirm): first click reveals "Are you sure? [Yes] [Cancel]"
 * in place, the second click runs the (server) action in a transition.
 * File path: /components/ui/confirm-button.tsx
 *
 * `action` may be a bound server action (deleteCustomer.bind(null, id));
 * a redirect thrown inside it is handled by Next. Escape cancels the
 * confirm step; focus lands on the Yes button so keyboard users can
 * confirm with Enter or back out with Escape.
 */

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useContent } from "@/components/providers/locale";
import { Spinner } from "@/components/ui/spinner";

export type ConfirmButtonProps = {
  children: ReactNode;
  action: () => Promise<unknown> | unknown;
  /** Question shown in the confirm step (default content.common.ui.confirmQuestion). */
  question?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" = red fill (delete); "ghost" = outline. */
  variant?: "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  onDone?: () => void;
};

export function ConfirmButton({
  children,
  action,
  question,
  confirmLabel,
  cancelLabel,
  variant = "ghost",
  size = "sm",
  disabled,
  className = "",
  onDone,
}: ConfirmButtonProps) {
  const c = useContent();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const yesRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) yesRef.current?.focus();
  }, [confirming]);

  const sizeClass = size === "sm" ? "btn-sm" : "";
  const variantClass = variant === "danger" ? "btn-primary" : "btn-ghost";

  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || pending}
        onClick={() => setConfirming(true)}
        className={`btn ${variantClass} ${sizeClass} ${className}`.trim()}
      >
        {children}
      </button>
    );
  }

  const cancel = () => {
    setConfirming(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  return (
    <span
      role="group"
      aria-label={question ?? c.common.ui.confirmQuestion}
      className="inline-flex flex-wrap items-center gap-2 border border-red px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <span className="text-[12px] font-bold tracking-[0.08em] text-red uppercase">
        {question ?? c.common.ui.confirmQuestion}
      </span>
      <button
        ref={yesRef}
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await action();
            setConfirming(false);
            onDone?.();
          })
        }
        className="btn btn-primary btn-sm"
      >
        {pending ? <Spinner /> : null}
        {confirmLabel ?? c.common.ui.confirmYes}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={cancel}
        className="btn btn-ghost btn-sm"
      >
        {cancelLabel ?? c.common.ui.confirmCancel}
      </button>
    </span>
  );
}
