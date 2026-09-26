/**
 * Human label for an override's rule code from the flags dictionary.
 * File path: /lib/admin/flag-message.ts
 *
 * The flags content (content/flags.ts) is owned by the feasibility UI
 * step and is structured as `flags[code]` → { label, message } (or a
 * plain string). This resolver is deliberately tolerant of either shape
 * and of the code living at the root or under a `flags` key, so the
 * override queue never breaks on a dictionary change: unknown codes fall
 * back to the raw code.
 */

function pick(node: unknown): string | null {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    for (const key of ["label", "title", "message"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return null;
}

export function resolveFlagLabel(flags: unknown, code: string): string {
  if (!flags || typeof flags !== "object") return code;
  const root = flags as Record<string, unknown>;
  const nested = root.flags && typeof root.flags === "object" ? (root.flags as Record<string, unknown>) : null;
  return pick(nested?.[code]) ?? pick(root[code]) ?? code;
}
