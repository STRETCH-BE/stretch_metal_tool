/**
 * Minimal chainable Supabase stub for the admin action tests.
 * File path: /test/admin/fake-supabase.ts
 *
 * `fakeClient({ table: { list, single } })` returns an object whose
 * `from(table)` yields a chain: every builder method (select, eq, in,
 * order, limit, range, insert, update, delete, like, gte, lte, neq)
 * returns the chain and records the call; awaiting the chain resolves the
 * next `list` result of that table, `maybeSingle()` / `single()` the next
 * `single` result. Results may be queues (arrays consumed in order) so one
 * test can script "read before → update → read after". `rpc` resolves
 * from `rpcs[name]`.
 */

import { vi } from "vitest";

export type FakeResult = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

export type FakeTable = {
  list?: FakeResult | FakeResult[];
  single?: FakeResult | FakeResult[];
};

export type FakeCall = { table: string; method: string; args: unknown[] };

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "in",
  "is",
  "like",
  "gte",
  "lte",
  "order",
  "limit",
  "range",
  "insert",
  "update",
  "delete",
] as const;

function next(source: FakeResult | FakeResult[] | undefined): FakeResult {
  if (Array.isArray(source)) {
    if (source.length === 0) return { data: null, error: null };
    return source.length > 1 ? (source.shift() as FakeResult) : source[0];
  }
  return source ?? { data: null, error: null };
}

export function fakeClient(
  tables: Record<string, FakeTable>,
  rpcs: Record<string, FakeResult> = {}
) {
  const calls: FakeCall[] = [];
  const from = vi.fn((table: string) => {
    const config = tables[table] ?? {};
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(async () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      const result = next(config.single);
      return { data: result.data ?? null, error: result.error ?? null };
    });
    chain.single = vi.fn(async () => {
      calls.push({ table, method: "single", args: [] });
      const result = next(config.single);
      return { data: result.data ?? null, error: result.error ?? null };
    });
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      calls.push({ table, method: "await", args: [] });
      const result = next(config.list);
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count ?? null,
      }).then(resolve, reject);
    };
    return chain;
  });
  const rpc = vi.fn(async (name: string) => {
    const result = rpcs[name] ?? { data: null, error: { message: `no rpc ${name}` } };
    return { data: result.data ?? null, error: result.error ?? null };
  });
  return { from, rpc, calls };
}

export function callsTo(calls: FakeCall[], table: string, method: string): FakeCall[] {
  return calls.filter((call) => call.table === table && call.method === method);
}
