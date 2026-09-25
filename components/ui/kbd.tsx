/**
 * Kbd — keyboard key hint (hairline box, 11px).
 * File path: /components/ui/kbd.tsx
 */

import type { ReactNode } from "react";

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <kbd className={`kbd ${className}`.trim()}>{children}</kbd>;
}
