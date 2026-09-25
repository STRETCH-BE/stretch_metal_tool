/**
 * Client-safe text helpers for UI primitives.
 * File path: /components/ui/format.ts
 *
 * lib/i18n.ts imports next/headers (server only), so client components
 * cannot pull `interpolate` from there. This is the same "{key}" template
 * filler, dependency-free. Recommended follow-up for the i18n owner: move
 * the pure formatting helpers (interpolate, formatNumber, formatMoney,
 * formatDate…) into a server-free module and re-export them from
 * lib/i18n.ts, then delete this file.
 */

/** "{count} lines" style interpolation for content templates. */
export function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`
  );
}
