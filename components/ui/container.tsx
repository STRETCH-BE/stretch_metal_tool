/**
 * Container — wraps section content at the STRETCH 1320px measure with the
 * fluid gutter (clamp(20px, 5vw, 64px)).
 * File path: /components/ui/container.tsx
 *
 * Use inside every section. Uses the .container-sm class from globals.css
 * (named to avoid colliding with Tailwind's own `container` utility).
 */

import type { ReactNode, ElementType } from "react";

type Props = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
};

export function Container({
  children,
  as: Tag = "div",
  className = "",
}: Props) {
  return <Tag className={`container-sm ${className}`.trim()}>{children}</Tag>;
}
