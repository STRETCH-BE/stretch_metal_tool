/**
 * Loosely typed PostgREST access for the ten rate tables.
 * File path: /lib/admin/db.ts
 *
 * The rate editor works on a table chosen at runtime (`RATE_TABLES[name]`),
 * and supabase-js cannot type `from(tableName)` for a union of ten tables
 * without ten switch branches per operation. This file narrows the client
 * to the handful of builder methods the admin code uses, on
 * `Record<string, unknown>` rows. That is honest: every row that leaves
 * the editor is validated by the zod schema in lib/admin/tables.ts before
 * it is written, and every row read back is only displayed. Never use it
 * for tables that have a proper typed path (profiles, quotes, overrides…).
 */

export type LooseRow = Record<string, unknown>;
export type LooseError = { message: string; code?: string; details?: string | null } | null;
export type LooseResult<T> = { data: T; error: LooseError; count?: number | null };

export interface LooseQuery extends PromiseLike<LooseResult<LooseRow[] | null>> {
  select(columns?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  neq(column: string, value: unknown): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  order(column: string, options?: { ascending?: boolean }): LooseQuery;
  limit(count: number): LooseQuery;
  range(from: number, to: number): LooseQuery;
  insert(values: LooseRow | LooseRow[]): LooseQuery;
  update(values: LooseRow): LooseQuery;
  delete(): LooseQuery;
  maybeSingle(): PromiseLike<LooseResult<LooseRow | null>>;
  single(): PromiseLike<LooseResult<LooseRow | null>>;
}

export interface LooseClient {
  from(table: string): LooseQuery;
}

/** Narrow any supabase client (server or admin) to the loose interface. */
export function looseClient(client: unknown): LooseClient {
  return client as LooseClient;
}

/** PostgREST / Postgres error → admin error code. */
export function dbErrorCode(error: NonNullable<LooseError>): "duplicateKey" | "versionHasQuotes" | "db" {
  if (error.code === "23505") return "duplicateKey";
  if (/immutable/i.test(error.message)) return "versionHasQuotes";
  return "db";
}
