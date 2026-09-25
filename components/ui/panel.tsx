/**
 * Panel — white (or black) bordered surface with an optional head row
 * (tracked uppercase title + actions) and a padded body.
 * File path: /components/ui/panel.tsx
 *
 * Server-safe. `.panel-head` / `.panel-title` carry light-surface colours
 * in globals.css; the dark tone overrides them with token variables via
 * inline style (unlayered CSS beats Tailwind utilities). `flush` drops
 * the body padding for tables that should run edge to edge.
 */

import type { ReactNode } from "react";

export type PanelProps = {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: "light" | "dark";
  /** No body padding — for tables. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
};

export function Panel({
  title,
  actions,
  children,
  tone = "light",
  flush = false,
  className = "",
  bodyClassName = "",
  id,
}: PanelProps) {
  const dark = tone === "dark";
  return (
    <section
      id={id}
      className={`${dark ? "panel-dark" : "panel"} ${className}`.trim()}
    >
      {(title || actions) && (
        <div
          className="panel-head"
          style={dark ? { borderBottomColor: "var(--color-line-dark)" } : undefined}
        >
          {title ? (
            <h2
              className="panel-title"
              style={dark ? { color: "var(--color-on-dark-muted)" } : undefined}
            >
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      <div className={`${flush ? "" : "panel-body"} ${bodyClassName}`.trim()}>
        {children}
      </div>
    </section>
  );
}
