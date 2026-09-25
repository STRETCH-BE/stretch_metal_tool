/**
 * SectionTitle — large Archivo Expanded heading (wdth 125, uppercase).
 * File path: /components/ui/section-title.tsx
 *
 * Accepts ReactNode children so the consumer can wrap one word in
 * <span className="text-red"> for the single red accent the identity
 * allows:
 *
 *   <SectionTitle>
 *     Masz rysunek? <span className="text-red">Masz wycenę.</span>
 *   </SectionTitle>
 */

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** HTML heading level. Default: h2 (section titles). Use h1 only in heroes. */
  as?: "h1" | "h2" | "h3";
  /** `display` is hero-tier (clamp 52–164px); `section` is the default h2 ramp. */
  size?: "section" | "section-sm" | "display";
  className?: string;
};

export function SectionTitle({
  children,
  as: Tag = "h2",
  size = "section",
  className = "",
}: Props) {
  const sizeClass =
    size === "display" ? "h-display" : size === "section-sm" ? "h2-sm" : "h2";

  return <Tag className={`${sizeClass} ${className}`.trim()}>{children}</Tag>;
}
