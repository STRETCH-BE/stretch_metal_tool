/**
 * CSV export of one rate table of a version (admin only).
 * File path: /app/api/admin/rates/[id]/[table]/csv/route.ts
 *
 * GET → text/csv attachment "<label>-<table>.csv" with the editable
 * columns + placeholder, in the natural-key order; the same header the
 * import expects. Role checked with assertRole; reads as the user (RLS).
 */

import { NextResponse } from "next/server";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/admin/csv";
import { getRateVersion, loadRateTableRows } from "@/lib/admin/rates";
import { csvColumns, isRateTableName } from "@/lib/admin/tables";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string; table: string }> }) {
  const { session, error } = await assertRole(["admin"]);
  if (error) return error;
  void session;
  const { id, table } = await context.params;
  if (!UUID.test(id) || !isRateTableName(table)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const supabase = await createClient();
  const version = await getRateVersion(supabase, id);
  if (!version) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = await loadRateTableRows(supabase, id, table);
  const columns = csvColumns(table);
  const csv = toCsv(
    columns,
    rows.map((row) => columns.map((column) => row[column] ?? null))
  );
  const safeLabel = version.label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "rates";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeLabel}-${table}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
