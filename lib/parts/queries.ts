/**
 * Part reads for the upload page, the quote upload page and the part page
 * — SERVER ONLY (RLS client as the user).
 * File path: /lib/parts/queries.ts
 *
 * The part page bundle joins everything the client workspace needs in
 * one place: part + item + quote, the original and PDF file rows, the
 * material options (code, name, family, density) and the flat-laser
 * thickness limits from the rate snapshot the quote is pinned to (active
 * version when unpinned). Missing rates never break the page: materials
 * come back empty and the UI shows the "no active rate version" notice.
 */

import type { FileRow, PartRow, QuoteItemRow, QuoteRow } from "@/lib/db/types";
import type { Flag, FlatLaserLimits, MaterialFamily } from "@/lib/pricing/types";
import type { PartAnnotations, PartGeometry, Triage, TriageState } from "@/lib/geometry/types";
import type { Suggestions } from "@/lib/ai/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import { loadMachinePark, loadRateSnapshot } from "@/lib/rates/load";
import { machineOf } from "@/lib/pricing/lookup";
import { parseSuggestions } from "@/lib/ai/types";
import { requirePartReader, type PartReader } from "./access";
import { parseStoredGeometry } from "./intake-db";
import { parseStoredAnnotations } from "./schema";

export type MaterialOption = { code: string; name: string; family: MaterialFamily; densityKgM3: number };

export type RatesInfo = {
  versionId: string | null;
  label: string | null;
  blankMarginMm: number;
  materials: MaterialOption[];
  flatLaser: { name: string; limits: FlatLaserLimits } | null;
};

/** Rate facts the part page needs; never throws (empty materials when no version). */
export async function loadRatesInfo(supabase: ServerSupabase, versionId: string | null): Promise<RatesInfo> {
  try {
    const [rates, park] = await Promise.all([loadRateSnapshot(supabase, versionId), loadMachinePark(supabase)]);
    const laser = machineOf(park, "flat_laser");
    return {
      versionId: rates.versionId,
      label: rates.label,
      blankMarginMm: rates.general.blankMarginMm,
      materials: rates.materials.map((m) => ({ code: m.code, name: m.name, family: m.family, densityKgM3: m.densityKgM3 })),
      flatLaser: laser ? { name: laser.name, limits: laser.limits } : null,
    };
  } catch (error) {
    console.error("[parts] rates unavailable", error);
    return { versionId: null, label: null, blankMarginMm: 10, materials: [], flatLaser: null };
  }
}

export function parseStoredFlags(value: unknown): Flag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is Flag =>
      Boolean(f) &&
      typeof f === "object" &&
      typeof (f as Flag).code === "string" &&
      typeof (f as Flag).severity === "string" &&
      typeof (f as Flag).params === "object"
  );
}

export function parseStoredSuggestions(value: unknown): Suggestions | null {
  if (!value || typeof value !== "object") return null;
  try {
    return parseSuggestions(value);
  } catch {
    return null;
  }
}

export function parseStoredTriage(value: unknown): Triage | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Partial<Triage>;
  return typeof t.state === "string" && Array.isArray(t.reasons) ? (t as Triage) : null;
}

/* ─── Lists ───────────────────────────────────────────────── */

export type PartListRow = {
  id: string;
  name: string;
  source: PartRow["source"];
  materialCode: string | null;
  thicknessMm: number | null;
  qty: number;
  itemId: string | null;
  triageState: TriageState | null;
  thumbnailSvg: string | null;
  hasPdf: boolean;
  worstFlag: Flag["severity"] | null;
  createdAt: string;
};

function worstSeverity(flags: Flag[]): Flag["severity"] | null {
  if (flags.some((f) => f.severity === "red")) return "red";
  if (flags.some((f) => f.severity === "amber")) return "amber";
  if (flags.length > 0) return "green";
  return null;
}

export async function listQuoteParts(supabase: ServerSupabase, quoteId: string): Promise<PartListRow[]> {
  const [{ data: parts, error }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from("parts")
      .select("id, name, source, material_code, thickness_mm, triage, thumbnail_svg, pdf_file_id, created_at")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: true }),
    supabase.from("quote_items").select("id, part_id, qty, position, flags").eq("quote_id", quoteId),
  ]);
  if (error) throw new Error(`parts list: ${error.message}`);
  if (itemsError) throw new Error(`quote_items list: ${itemsError.message}`);
  const itemByPart = new Map((items ?? []).map((i) => [i.part_id, i] as const));
  const rows = (parts ?? []).map((p): PartListRow => {
    const item = itemByPart.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      source: p.source,
      materialCode: p.material_code,
      thicknessMm: p.thickness_mm === null ? null : Number(p.thickness_mm),
      qty: item ? Number(item.qty) : 1,
      itemId: item?.id ?? null,
      triageState: parseStoredTriage(p.triage)?.state ?? null,
      thumbnailSvg: p.thumbnail_svg,
      hasPdf: p.pdf_file_id !== null,
      worstFlag: worstSeverity(parseStoredFlags(item?.flags)),
      createdAt: p.created_at,
    };
  });
  const position = (row: PartListRow) => Number(itemByPart.get(row.id)?.position ?? Number.MAX_SAFE_INTEGER);
  return rows.sort((a, b) => position(a) - position(b) || a.createdAt.localeCompare(b.createdAt));
}

export type RecentDraft = {
  id: string;
  number: string;
  version: number;
  status: QuoteRow["status"];
  customerName: string | null;
  partCount: number;
  updatedAt: string;
};

/** The user's own draft quotes, newest first (admins see their own too). */
export async function listRecentDrafts(supabase: ServerSupabase, userId: string, limit = 10): Promise<RecentDraft[]> {
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("id, number, version, status, customer_id, updated_at")
    .eq("created_by", userId)
    .in("status", ["draft", "pending_override"])
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`quotes list: ${error.message}`);
  const list = quotes ?? [];
  if (list.length === 0) return [];
  const ids = list.map((q) => q.id);
  const customerIds = Array.from(new Set(list.map((q) => q.customer_id).filter((id): id is string => Boolean(id))));
  const [{ data: items }, { data: customers }] = await Promise.all([
    supabase.from("quote_items").select("quote_id").in("quote_id", ids),
    customerIds.length
      ? supabase.from("customers").select("id, name").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const counts = new Map<string, number>();
  for (const item of items ?? []) counts.set(item.quote_id, (counts.get(item.quote_id) ?? 0) + 1);
  const names = new Map((customers ?? []).map((c) => [c.id, c.name] as const));
  return list.map((q) => ({
    id: q.id,
    number: q.number,
    version: Number(q.version),
    status: q.status,
    customerName: q.customer_id ? (names.get(q.customer_id) ?? null) : null,
    partCount: counts.get(q.id) ?? 0,
    updatedAt: q.updated_at,
  }));
}

/* ─── Part page bundle ────────────────────────────────────── */

export type PartPageData = {
  reader: PartReader;
  part: PartRow;
  item: QuoteItemRow | null;
  quote: QuoteRow;
  geometry: PartGeometry | null;
  annotations: PartAnnotations;
  triage: Triage | null;
  suggestions: Suggestions | null;
  flags: Flag[];
  file: FileRow | null;
  pdfFile: FileRow | null;
  rates: RatesInfo;
  canWrite: boolean;
};

export async function loadPartPage(partId: string): Promise<PartPageData> {
  const reader = await requirePartReader(partId);
  const { supabase, part, item, quote, session } = reader;
  const fileIds = [part.file_id, part.pdf_file_id].filter((id): id is string => Boolean(id));
  const [files, rates] = await Promise.all([
    fileIds.length ? supabase.from("files").select("*").in("id", fileIds) : Promise.resolve({ data: [] as FileRow[] }),
    loadRatesInfo(supabase, quote.rate_version_id),
  ]);
  const byId = new Map((files.data ?? []).map((f) => [f.id, f] as const));
  const geometry = parseStoredGeometry(part.geometry);
  const canWrite =
    (session.profile.role === "admin" || (session.profile.role === "sales" && quote.created_by === session.user.id)) &&
    (quote.status === "draft" || quote.status === "pending_override") &&
    !quote.geometry_locked;
  return {
    reader,
    part,
    item,
    quote,
    geometry,
    annotations: parseStoredAnnotations(part.annotations),
    triage: parseStoredTriage(part.triage) ?? geometry?.triage ?? null,
    suggestions: parseStoredSuggestions(part.ai_suggestions),
    flags: parseStoredFlags(item?.flags),
    file: part.file_id ? (byId.get(part.file_id) ?? null) : null,
    pdfFile: part.pdf_file_id ? (byId.get(part.pdf_file_id) ?? null) : null,
    rates,
    canWrite,
  };
}
