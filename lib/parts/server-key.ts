/**
 * React `key` for a form that seeds local state from server values.
 * File path: /lib/parts/server-key.ts
 *
 * The part page panels (material, quantity, bend rows) hold their inputs
 * in local state seeded from props; other panels can change the same
 * values on the server (accept a suggestion, materialise bends) and
 * router.refresh() then delivers new props. Keying the form on those
 * values remounts it whenever the server value changes, so the inputs
 * show the new value and Save is disabled again instead of re-posting the
 * stale one. While the values are unchanged the key is stable and an edit
 * in progress survives the refresh.
 */

export type ServerKeyValue = string | number | boolean | null | undefined;

export function serverKey(...values: ServerKeyValue[]): string {
  return values.map((v) => (v === null ? "∅" : v === undefined ? "?" : String(v))).join("|");
}
