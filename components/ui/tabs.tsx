"use client";

/**
 * Tabs — hard-edged tab strip (black 2px underline on the active tab).
 * File path: /components/ui/tabs.tsx
 *
 * WAI-ARIA tabs pattern: role="tablist"/"tab", aria-selected, roving
 * tabindex, Arrow/Home/End keys move and select. Panels are the consumer's
 * concern — give them role="tabpanel" and aria-labelledby={`${id}-tab-${value}`}.
 */

import { useId, useRef, type KeyboardEvent } from "react";
import { useContent } from "@/components/providers/locale";

export type TabItem = { value: string; label: string; disabled?: boolean };

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Prefix for the tab element ids (defaults to a generated id). */
  id?: string;
  className?: string;
};

export function Tabs({ items, value, onChange, ariaLabel, id, className = "" }: TabsProps) {
  const c = useContent();
  const generated = useId();
  const baseId = id ?? generated;
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const enabled = items.filter((item) => !item.disabled);

  const move = (event: KeyboardEvent<HTMLButtonElement>, current: string) => {
    const index = enabled.findIndex((item) => item.value === current);
    if (index === -1) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = enabled.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = enabled[nextIndex].value;
    onChange(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? c.common.ui.tabs}
      className={`flex flex-wrap border-b border-border ${className}`.trim()}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
              else refs.current.delete(item.value);
            }}
            id={`${baseId}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => move(event, item.value)}
            className={`-mb-px border-b-2 px-4 py-3 text-[11.5px] font-bold tracking-[0.14em] uppercase disabled:opacity-40 ${
              selected
                ? "border-black text-black"
                : "border-transparent text-text-muted hover:text-black"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
