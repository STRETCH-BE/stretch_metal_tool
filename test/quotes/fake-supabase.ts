/**
 * In-memory PostgREST stand-in for the quote tests: enough of the
 * supabase-js query builder (from/select/insert/update/delete with
 * eq/in/or/ilike/order/range/limit/maybeSingle/single, rpc, storage
 * upload) to run lib/quotes/reprice.ts and the server actions without a
 * database. Every call is recorded so tests can assert on the writes.
 * File path: /test/quotes/fake-supabase.ts
 *
 * Filters implement exact `eq`, `in` and a tiny subset of `or`
 * ("col.eq.v", "col.ilike.%v%", "col.in.(a,b)"); ordering by one column
 * ascending/descending; `range` slices. Inserted rows get uuid-ish ids
 * and timestamps when missing. Not a database: no RLS, no cascades
 * beyond parts → quote_items → operations (implemented because
 * removeItem relies on it).
 */

import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type Write =
  | { op: "insert"; table: string; rows: Row[] }
  | { op: "update"; table: string; patch: Row; filters: Filter[] }
  | { op: "delete"; table: string; filters: Filter[] }
  | { op: "upload"; bucket: string; path: string; size: number };

type Filter = { kind: "eq"; column: string; value: unknown } | { kind: "in"; column: string; values: unknown[] } | { kind: "or"; expr: string } | { kind: "ilike"; column: string; pattern: string };

type Order = { column: string; ascending: boolean };

function get(row: Row, column: string): unknown {
  if (column.includes("->>")) {
    const [json, key] = column.split("->>");
    const obj = row[json];
    return obj && typeof obj === "object" ? (obj as Row)[key] : undefined;
  }
  return row[column];
}

function likeToRegex(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
}

function matchesOr(row: Row, expr: string): boolean {
  // split on top-level commas (parentheses of in.(a,b) are respected)
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts.some((part) => {
    const m = /^([\w>-]+)\.(eq|ilike|in)\.(.*)$/.exec(part.trim());
    if (!m) return false;
    const [, column, op, raw] = m;
    const value = get(row, column);
    if (op === "eq") return String(value) === raw;
    if (op === "ilike") return typeof value === "string" && likeToRegex(raw).test(value);
    const list = raw.replace(/^\(|\)$/g, "").split(",");
    return list.includes(String(value));
  });
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === "eq") return get(row, f.column) === f.value;
      if (f.kind === "in") return f.values.includes(get(row, f.column));
      if (f.kind === "ilike") return typeof get(row, f.column) === "string" && likeToRegex(f.pattern).test(get(row, f.column) as string);
      return matchesOr(row, f.expr);
    })
  );
}

export class FakeSupabase {
  readonly tables: Tables;
  readonly writes: Write[] = [];
  readonly rpcs: Record<string, (args: Row) => unknown> = {};

  constructor(tables: Tables = {}) {
    this.tables = tables;
  }

  private rowsOf(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    return new Query(this, table);
  }

  async rpc(name: string, args: Row = {}) {
    const fn = this.rpcs[name];
    if (!fn) return { data: null, error: { message: `rpc ${name} not stubbed` } };
    return { data: fn(args), error: null };
  }

  get storage() {
    const writes = this.writes;
    return {
      from(bucket: string) {
        return {
          async upload(path: string, body: Buffer | Uint8Array) {
            writes.push({ op: "upload", bucket, path, size: body.byteLength });
            return { data: { path }, error: null };
          },
        };
      },
    };
  }

  /** @internal */
  _insert(table: string, rows: Row[]): Row[] {
    const now = new Date().toISOString();
    const inserted = rows.map((row) => ({
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      ...row,
    }));
    this.rowsOf(table).push(...inserted);
    this.writes.push({ op: "insert", table, rows: inserted });
    return inserted;
  }

  /** @internal */
  _update(table: string, patch: Row, filters: Filter[]): Row[] {
    const targets = applyFilters(this.rowsOf(table), filters);
    for (const row of targets) Object.assign(row, patch, { updated_at: new Date().toISOString() });
    this.writes.push({ op: "update", table, patch, filters });
    return targets;
  }

  /** @internal */
  _delete(table: string, filters: Filter[]): Row[] {
    const targets = new Set(applyFilters(this.rowsOf(table), filters));
    this.tables[table] = this.rowsOf(table).filter((row) => !targets.has(row));
    this.writes.push({ op: "delete", table, filters });
    // minimal cascades used by the quote tests
    if (table === "parts") {
      const ids = Array.from(targets).map((r) => r.id);
      const items = this.rowsOf("quote_items").filter((i) => ids.includes(i.part_id));
      this.tables.quote_items = this.rowsOf("quote_items").filter((i) => !ids.includes(i.part_id));
      const itemIds = items.map((i) => i.id);
      this.tables.operations = this.rowsOf("operations").filter((o) => !itemIds.includes(o.quote_item_id));
    }
    return Array.from(targets);
  }

  /** @internal */
  _select(table: string, filters: Filter[], orders: Order[], range: [number, number] | null, limit: number | null): Row[] {
    let rows = applyFilters(this.rowsOf(table), filters);
    for (const order of [...orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = get(a, order.column) as string | number;
        const y = get(b, order.column) as string | number;
        const cmp = x < y ? -1 : x > y ? 1 : 0;
        return order.ascending ? cmp : -cmp;
      });
    }
    if (range) rows = rows.slice(range[0], range[1] + 1);
    if (limit !== null) rows = rows.slice(0, limit);
    return rows.map((row) => ({ ...row }));
  }
}

type Mode = "select" | "insert" | "update" | "delete";

class Query implements PromiseLike<{ data: unknown; error: null | { message: string }; count: number | null }> {
  private mode: Mode = "select";
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private rangeSpec: [number, number] | null = null;
  private limitSpec: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private payload: Row | Row[] | null = null;
  private wantCount = false;
  private returning = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string
  ) {}

  select(_columns?: string, options?: { count?: string }) {
    if (this.mode !== "select") this.returning = true;
    if (options?.count) this.wantCount = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  or(expr: string) {
    this.filters.push({ kind: "or", expr });
    return this;
  }
  ilike(column: string, pattern: string) {
    this.filters.push({ kind: "ilike", column, pattern });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.rangeSpec = [from, to];
    return this;
  }
  limit(n: number) {
    this.limitSpec = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }

  private run(): { data: unknown; error: null | { message: string }; count: number | null } {
    let rows: Row[];
    if (this.mode === "select") {
      rows = this.db._select(this.table, this.filters, this.orders, this.rangeSpec, this.limitSpec);
    } else if (this.mode === "insert") {
      rows = this.db._insert(this.table, Array.isArray(this.payload) ? (this.payload as Row[]) : [this.payload as Row]);
    } else if (this.mode === "update") {
      rows = this.db._update(this.table, this.payload as Row, this.filters);
    } else {
      rows = this.db._delete(this.table, this.filters);
    }
    const count = this.wantCount ? applyCount(this.db, this.table, this.filters) : null;
    if (this.singleMode === "single") {
      if (rows.length !== 1) return { data: null, error: { message: `expected one row, got ${rows.length}` }, count };
      return { data: rows[0], error: null, count };
    }
    if (this.singleMode === "maybeSingle") return { data: rows[0] ?? null, error: null, count };
    if (this.mode !== "select" && !this.returning) return { data: null, error: null, count };
    return { data: rows, error: null, count };
  }

  then<R1 = unknown, R2 = never>(
    resolve?: ((value: { data: unknown; error: null | { message: string }; count: number | null }) => R1 | PromiseLike<R1>) | null,
    reject?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return Promise.resolve().then(() => this.run()).then(resolve ?? undefined, reject ?? undefined);
  }
}

function applyCount(db: FakeSupabase, table: string, filters: Filter[]): number {
  return db._select(table, filters, [], null, null).length;
}
