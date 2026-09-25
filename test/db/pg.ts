/**
 * Local-Postgres helper for the database tests (migration + seed validation).
 * File path: /test/db/pg.ts
 *
 * The db tests only run with SMTOOL_LOCAL_PG=1 (see seed.test.ts). They
 * expect the Postgres 16 that CLAUDE.md documents: listening on the unix
 * socket in /tmp, port 5433, peer-authenticated `postgres` OS user — so
 * every call shells out to `su postgres -c "psql …"`. Set SMTOOL_PG_SU=0 to
 * call psql directly when the current user can connect by itself.
 *
 * Non-obvious decisions:
 *   - The postgres user cannot read the (root-owned) repo, so every SQL file
 *     is staged into a fresh world-readable directory under /tmp first.
 *   - Queries are wrapped in `json_agg` and read back with `psql -At`, which
 *     gives typed values (numeric → number, jsonb → object) without a driver
 *     dependency.
 *   - The default database is `smtool_seed_test`, a scratch database of its
 *     own, so a reset never interrupts someone validating a migration in the
 *     shared `smtool`. Override with SMTOOL_PG_DATABASE.
 *   - `drop database … with (force)` terminates stale connections to the
 *     scratch database so a crashed earlier run cannot wedge the suite.
 *   - psql runs through spawnSync so stderr is captured on success too: the
 *     seed reports its "version referenced by quotes" branch as a NOTICE,
 *     which psql prints on stderr, and the tests assert on it.
 *   - `singleTransaction` (psql -1) is opt-in: `runSeed` uses it because
 *     that is the command supabase/README.md documents for seed.sql, but a
 *     `drop database` / `create database` cannot run inside a transaction
 *     block, so the reset and ad-hoc statements run without it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PG_HOST = process.env.SMTOOL_PG_HOST ?? "/tmp";
export const PG_PORT = process.env.SMTOOL_PG_PORT ?? "5433";
export const PG_DATABASE = process.env.SMTOOL_PG_DATABASE ?? "smtool_seed_test";
const RUN_AS_POSTGRES = process.env.SMTOOL_PG_SU !== "0";

export const REPO_ROOT = path.resolve(__dirname, "../..");
export const STUB_SQL = path.join(REPO_ROOT, "test/supabase-stub.sql");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");
export const SEED_SQL = path.join(REPO_ROOT, "supabase/seed.sql");

export type PsqlResult = { stdout: string; stderr: string };

export type RunOptions = {
  /** Wrap the whole file in one transaction (`psql -1`): any error rolls back everything. */
  singleTransaction?: boolean;
};

let stagingDir: string | null = null;

/** World-readable scratch directory under /tmp (postgres must read the files). */
function staging(): string {
  if (!stagingDir) {
    stagingDir = fs.mkdtempSync(path.join("/tmp", "smtool-db-test-"));
    fs.chmodSync(stagingDir, 0o755);
  }
  return stagingDir;
}

/** Remove the staging directory (call from afterAll). */
export function cleanupStaging(): void {
  if (stagingDir) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    stagingDir = null;
  }
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

let fileSeq = 0;

/** Copy (or write) a SQL file into the staging directory, readable by postgres. */
function stageSql(source: { file: string } | { sql: string; name: string }): string {
  const dir = staging();
  const target =
    "file" in source
      ? path.join(dir, `${++fileSeq}-${path.basename(source.file)}`)
      : path.join(dir, `${++fileSeq}-${source.name}.sql`);
  if ("file" in source) fs.copyFileSync(source.file, target);
  else fs.writeFileSync(target, source.sql, "utf8");
  fs.chmodSync(target, 0o644);
  return target;
}

/**
 * Run `psql -f file` against `database`. Throws (with stderr in the message)
 * when psql exits non-zero; ON_ERROR_STOP makes any SQL error fatal. On
 * success the result carries stdout (command tags) and stderr (NOTICEs).
 */
export function psqlFile(
  database: string,
  file: string,
  extraArgs: string[] = [],
  options: RunOptions = {}
): PsqlResult {
  const args = [
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    ...(options.singleTransaction ? ["--single-transaction"] : []),
    "-h",
    PG_HOST,
    "-p",
    PG_PORT,
    "-d",
    database,
    ...extraArgs,
    "-f",
    file,
  ];
  const command = args.map(shellQuote).join(" ");
  const run = spawnSync(
    RUN_AS_POSTGRES ? "su" : "sh",
    RUN_AS_POSTGRES ? ["postgres", "-c", command] : ["-c", command],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  if (run.error || run.status !== 0) {
    throw new Error(
      `psql failed for ${path.basename(file)} on ${database} (exit ${String(run.status)}):\n${stderr}${run.error?.message ?? ""}`
    );
  }
  return { stdout, stderr };
}

/** Run a SQL file from the repo (copied to /tmp first). Returns psql's output. */
export function runSqlFile(database: string, file: string, options: RunOptions = {}): PsqlResult {
  return psqlFile(database, stageSql({ file }), [], options);
}

/** Run an ad-hoc SQL string (one psql session, so SET/SELECT sequences work). */
export function runSql(database: string, sql: string, name = "adhoc", options: RunOptions = {}): PsqlResult {
  return psqlFile(database, stageSql({ sql, name }), [], options);
}

/**
 * Apply a seed file the way supabase/README.md documents it:
 * `psql -v ON_ERROR_STOP=1 --single-transaction -f seed.sql`. `file` defaults
 * to supabase/seed.sql; the tests also pass edited or broken copies.
 */
export function runSeed(database: string, file = SEED_SQL): PsqlResult {
  return runSqlFile(database, file, { singleTransaction: true });
}

/**
 * Run a SELECT and get its rows as JSON. The query is wrapped in json_agg, so
 * numeric columns come back as numbers and jsonb columns as objects.
 */
export function queryJson<T>(database: string, select: string): T[] {
  // jsonb_agg (not json_agg): its text form is one compact line, whereas
  // json_agg breaks elements over several lines.
  const wrapped = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (${select}) as t;`;
  const { stdout } = psqlFile(database, stageSql({ sql: wrapped, name: "query" }), ["-At"]);
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "[]";
  return JSON.parse(line) as T[];
}

/** Single-value convenience: first column of the first row. */
export function queryScalar<T>(database: string, select: string): T {
  const rows = queryJson<Record<string, T>>(database, select);
  const first = rows[0];
  if (!first) throw new Error(`queryScalar: no row for ${select}`);
  const values = Object.values(first);
  if (values.length !== 1) throw new Error(`queryScalar: expected one column, got ${values.length}`);
  return values[0];
}

/** All migration files in filename order (the order the Supabase CLI uses). */
export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/**
 * Drop + create `database`, then apply the Supabase stub schemas, every
 * migration and (by default) seed.sql — the same sequence CLAUDE.md gives for
 * resetting the local database.
 */
export function resetDatabase(database = PG_DATABASE, options: { seed?: boolean } = {}): void {
  const { seed = true } = options;
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) {
    throw new Error(`refusing to reset database with unsafe name: ${database}`);
  }
  runSql(
    "postgres",
    `drop database if exists ${database} with (force);\ncreate database ${database};\n`,
    "reset"
  );
  runSqlFile(database, STUB_SQL);
  for (const file of migrationFiles()) runSqlFile(database, file);
  if (seed) runSeed(database);
}
