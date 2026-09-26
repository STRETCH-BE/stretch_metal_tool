/**
 * Row-set diff by natural key — "diff against active" for rate tables.
 * File path: /lib/admin/diff.ts
 *
 * Pure. Two arrays of rows are matched on `keyOf(row)`; a key present only
 * in the target is "added", only in the base "removed", in both with any
 * compared column differing "changed" (with the list of differing
 * columns). Cells are normalised before comparison because PostgREST may
 * deliver `numeric` columns as strings on one side and numbers on the
 * other: numeric strings → numbers, objects → key-sorted JSON, strings
 * trimmed, null/undefined equal.
 */

export type RowDiff<T> = {
  key: string;
  kind: "added" | "removed" | "changed";
  before: T | null;
  after: T | null;
  /** Columns whose normalised value differs (empty for added/removed). */
  columns: string[];
};

export type DiffResult<T> = {
  added: RowDiff<T>[];
  removed: RowDiff<T>[];
  changed: RowDiff<T>[];
  unchanged: number;
};

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(normalizeCell(value));
}

/** Canonical comparable form of a cell. */
export function normalizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    return trimmed;
  }
  return sortedJson(value);
}

export function cellsEqual(a: unknown, b: unknown): boolean {
  return normalizeCell(a) === normalizeCell(b);
}

export function diffRows<T extends Record<string, unknown>>(
  base: readonly T[],
  target: readonly T[],
  keyOf: (row: T) => string,
  columns: readonly string[]
): DiffResult<T> {
  const baseByKey = new Map<string, T>();
  for (const row of base) baseByKey.set(keyOf(row), row);
  const targetByKey = new Map<string, T>();
  for (const row of target) targetByKey.set(keyOf(row), row);

  const added: RowDiff<T>[] = [];
  const removed: RowDiff<T>[] = [];
  const changed: RowDiff<T>[] = [];
  let unchanged = 0;

  for (const [key, after] of targetByKey) {
    const before = baseByKey.get(key);
    if (!before) {
      added.push({ key, kind: "added", before: null, after, columns: [] });
      continue;
    }
    const diffColumns = columns.filter((column) => !cellsEqual(before[column], after[column]));
    if (diffColumns.length === 0) {
      unchanged += 1;
    } else {
      changed.push({ key, kind: "changed", before, after, columns: diffColumns });
    }
  }
  for (const [key, before] of baseByKey) {
    if (!targetByKey.has(key)) {
      removed.push({ key, kind: "removed", before, after: null, columns: [] });
    }
  }
  const byKey = (a: RowDiff<T>, b: RowDiff<T>) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  added.sort(byKey);
  removed.sort(byKey);
  changed.sort(byKey);
  return { added, removed, changed, unchanged };
}
