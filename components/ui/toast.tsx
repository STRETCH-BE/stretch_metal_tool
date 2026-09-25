"use client";

/**
 * Toast provider + useToast() — bottom-right black notices with a red
 * (error), green (success) or muted (neutral) left bar; auto-dismiss.
 * File path: /components/ui/toast.tsx
 *
 * Mount <ToastProvider> once in the app layout. The stack is an aria-live
 * polite region; each toast has a dismiss button. `.toast` in globals.css
 * is position:fixed for a single notice — inside the stacked container it
 * is made static via inline style so several can coexist.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useContent } from "@/components/providers/locale";

export type ToastTone = "neutral" | "success" | "error";

export type ToastOptions = {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss (default 4500; 0 = sticky). */
  durationMs?: number;
};

type ToastItem = { id: number; message: string; tone: ToastTone; durationMs: number };

type ToastApi = {
  toast: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const BAR: Record<ToastTone, string> = {
  neutral: "var(--color-on-dark-muted)",
  success: "var(--color-flag-green)",
  error: "var(--color-red)",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = nextId.current++;
    setItems((current) => [
      ...current,
      {
        id,
        message,
        tone: options.tone ?? "neutral",
        durationMs: options.durationMs ?? 4500,
      },
    ]);
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast() must be used inside <ToastProvider>.");
  return api;
}

function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const c = useContent();
  return (
    <div
      aria-live="polite"
      aria-label={c.common.ui.notifications}
      className="pointer-events-none fixed right-5 bottom-5 z-[100] flex flex-col items-end gap-2"
    >
      {items.map((item) => (
        <ToastView key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastView({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const c = useContent();
  useEffect(() => {
    if (item.durationMs <= 0) return;
    const timer = window.setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.id, item.durationMs, onDismiss]);

  return (
    <div
      role="status"
      className="toast pointer-events-auto flex items-start gap-4"
      style={{ position: "relative", right: "auto", bottom: "auto", borderLeftColor: BAR[item.tone] }}
    >
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={c.common.ui.dismiss}
        className="text-[11px] font-bold tracking-[0.12em] text-on-dark-muted uppercase hover:text-white"
      >
        {c.common.ui.close}
      </button>
    </div>
  );
}
