/**
 * Brand logo lockup — typographic "STRETCHMETAL" with the red pixel accent.
 * File path: /components/ui/logo.tsx
 *
 * Copied from the stretch_metal website: Archivo at wdth 125, 900 weight,
 * uppercase, tight tracking. "STRETCH" carries the brand red, "METAL"
 * flips black/white per surface, and a red square (the group's pixel
 * motif) closes the lockup. The quoting tool adds an optional `suffix`
 * ("QUOTE") rendered in the muted tone so the app is distinguishable from
 * the public website in the browser tab strip.
 */

import Link from "next/link";

type Props = {
  tone?: "on-dark" | "on-light";
  /** Pixel font size for the wordmark — default 20 (nav), pass 24 in footer. */
  size?: number;
  /** Where the lockup links to — default the app home. */
  href?: string;
  /** Accessible name, supplied from content per locale. */
  ariaLabel: string;
  /** Optional muted word after the wordmark (e.g. "QUOTE"). */
  suffix?: string;
  className?: string;
};

export function Logo({
  tone = "on-dark",
  size = 20,
  href = "/",
  ariaLabel,
  suffix,
  className = "",
}: Props) {
  const metalColor = tone === "on-light" ? "text-black" : "text-white";
  const suffixColor =
    tone === "on-light" ? "text-text-faint" : "text-on-dark-muted";
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`inline-flex items-baseline font-black uppercase leading-none tracking-[-0.03em] ${className}`.trim()}
      style={{
        fontSize: size,
        fontFamily: "var(--font-display)",
        fontVariationSettings: "'wdth' 125",
      }}
    >
      <span className="text-red">STRETCH</span>
      <span className={metalColor}>METAL</span>
      <span
        aria-hidden="true"
        className="ml-[4px] inline-block bg-red"
        style={{ width: size * 0.28, height: size * 0.28 }}
      />
      {suffix && (
        <span
          className={`ml-[10px] font-bold tracking-[0.12em] ${suffixColor}`}
          style={{ fontSize: size * 0.55, fontVariationSettings: "'wdth' 100" }}
        >
          {suffix}
        </span>
      )}
    </Link>
  );
}
