"use client";

/**
 * Modal — hard-edged dialog over a dark backdrop.
 * File path: /components/ui/modal.tsx
 *
 * Accessibility: role="dialog" + aria-modal, labelled by the title; focus
 * moves into the dialog on open — `initialFocusRef` if given, else the
 * first focusable control inside .panel-body (the header Close button is
 * deliberately skipped), else the panel itself. Tab/Shift+Tab cycle
 * inside it, Escape and a backdrop click call onClose, and focus returns
 * to the opener when the dialog closes or unmounts.
 *
 * The trap effect depends on `open` only: `onClose` is read through a
 * ref, so a parent re-rendering with a fresh inline callback (typing in
 * a controlled input inside the dialog) never re-initialises the trap
 * or moves focus. `initialFocusRef` must be a stable ref (useRef).
 *
 * Rendered inline (no portal) — .modal-backdrop is position:fixed so any
 * ancestor works unless it is transformed; keep modals out of
 * transformed containers.
 */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useContent } from "@/components/providers/locale";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Element to focus on open instead of the first control in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MAX_WIDTH: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "420px",
  md: "560px",
  lg: "860px",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  className = "",
  initialFocusRef,
}: ModalProps) {
  const c = useContent();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const target =
      initialFocusRef?.current ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || active === panel)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal ${className}`.trim()}
        style={{ maxWidth: MAX_WIDTH[size] }}
      >
        <div className="panel-head">
          <h2 id={titleId} className="panel-title">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label={c.common.ui.close}
          >
            {c.common.ui.close}
          </button>
        </div>
        <div ref={bodyRef} className="panel-body">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
