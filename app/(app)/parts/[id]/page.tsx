/**
 * Part page — viewer + triage / material / measures / holes / bends /
 * welds / roll / PDF-AI / flags / quantity / actions panels.
 * File path: /app/(app)/parts/[id]/page.tsx
 *
 * Server component: loads the part bundle (lib/parts/queries.ts) and
 * derives the viewer geometry. parts.geometry is the annotated snapshot
 * (panels read it); the viewer applies annotations itself, so when the
 * annotations scale / mirror / delete anything it gets the base analysis
 * re-derived from the stored file (SHA-256 cache first). Access errors
 * map to 404 (not found / bad id) — the layout already redirected
 * signed-out users.
 *
 * Assembly membership (read-only, the page's RLS client): when the part's
 * quote item carries assembly_id the assembly row and its seams are
 * loaded so the workspace can offer "Add as assembly seam" per weld and
 * mark the welds already stored. A database without the assembly tables
 * (migration not applied) or any read error → no membership, the part
 * page still works.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { env } from "@/lib/env";
import type { AssemblySeamRow } from "@/lib/db/types";
import type { PartGeometry } from "@/lib/geometry/types";
import { PartAccessError } from "@/lib/parts/access";
import { loadPartPage, type PartPageData } from "@/lib/parts/queries";
import { baseGeometryFor, isBaseEquivalent } from "@/lib/parts/reanalyse";
import { makeReanalyseDeps } from "@/lib/parts/server-deps";
import { isUuid } from "@/lib/parts/schema";
import { PartWorkspace } from "@/components/parts/part-workspace";

type Params = Promise<{ id: string }>;

async function loadOrNotFound(id: string): Promise<PartPageData> {
  if (!isUuid(id)) notFound();
  try {
    return await loadPartPage(id);
  } catch (error) {
    if (error instanceof PartAccessError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const c = getContent(await getLocale());
  if (!isUuid(id)) return { title: c.upload.part.eyebrow };
  try {
    const data = await loadPartPage(id);
    return { title: data.part.name };
  } catch {
    return { title: c.upload.part.eyebrow };
  }
}

async function viewerGeometryFor(data: PartPageData): Promise<PartGeometry | null> {
  const { geometry, annotations, part, file, rates } = data;
  if (!geometry) return null;
  if (part.source !== "dxf" || !file || isBaseEquivalent(annotations)) return geometry;
  try {
    const density = part.material_code
      ? (rates.materials.find((m) => m.code.toLowerCase() === part.material_code!.toLowerCase())?.densityKgM3 ?? null)
      : null;
    const base = await baseGeometryFor(
      {
        id: part.id,
        source: part.source,
        name: part.name,
        storagePath: file.storage_path,
        fileHash: part.file_hash,
        geometry,
        annotations,
        pdfText: part.pdf_text,
        thicknessMm: part.thickness_mm === null ? null : Number(part.thickness_mm),
        densityKgM3: density,
      },
      { toleranceMm: geometry.healing.toleranceMm, blankMarginMm: rates.blankMarginMm },
      makeReanalyseDeps(data.reader.supabase)
    );
    return base.geometry;
  } catch (error) {
    console.error("[parts] base geometry unavailable, viewer shows the stored snapshot", error);
    return geometry;
  }
}

type AssemblyMembership = { id: string; name: string; seams: AssemblySeamRow[] };

async function loadAssemblyMembership(data: PartPageData): Promise<AssemblyMembership | null> {
  const assemblyId = data.item?.assembly_id ?? null;
  if (!assemblyId) return null;
  try {
    const supabase = data.reader.supabase;
    const [assembly, seams] = await Promise.all([
      supabase.from("assemblies").select("id, name").eq("id", assemblyId).maybeSingle(),
      supabase.from("assembly_seams").select("*").eq("assembly_id", assemblyId).order("position", { ascending: true }),
    ]);
    if (assembly.error || !assembly.data) return null;
    return { id: assembly.data.id, name: assembly.data.name, seams: (seams.data ?? []) as AssemblySeamRow[] };
  } catch (error) {
    console.warn("[parts] assembly membership unavailable", error);
    return null;
  }
}

function parseFinishCodes(extras: unknown): string[] {
  if (!Array.isArray(extras)) return [];
  return extras
    .filter((e): e is { type: string; code: string } => Boolean(e) && typeof e === "object" && (e as { type?: unknown }).type === "finish" && typeof (e as { code?: unknown }).code === "string")
    .map((e) => e.code);
}

export default async function PartPage({ params }: { params: Params }) {
  const { id } = await params;
  const data = await loadOrNotFound(id);
  const [viewerGeometry, assembly] = await Promise.all([viewerGeometryFor(data), loadAssemblyMembership(data)]);
  const { part, quote, item } = data;

  return (
    <PartWorkspace
      partId={part.id}
      quoteId={quote.id}
      quoteNumber={`${quote.number}${quote.version > 1 ? `-v${quote.version}` : ""}`}
      name={part.name}
      source={part.source}
      materialCode={part.material_code}
      thicknessMm={part.thickness_mm === null ? null : Number(part.thickness_mm)}
      geometry={data.geometry}
      viewerGeometry={viewerGeometry}
      annotations={data.annotations}
      triage={data.triage}
      suggestions={data.suggestions}
      flags={data.flags}
      item={
        item
          ? { id: item.id, qty: Number(item.qty), unitCost: Number(item.unit_cost), unitPrice: item.unit_price === null ? null : Number(item.unit_price), finishCodes: parseFinishCodes(item.extras) }
          : null
      }
      quote={{ currency: quote.currency, fxRate: Number(quote.fx_rate), priced: quote.priced_at !== null }}
      fileId={data.file?.id ?? null}
      flatFileId={data.flatFile?.id ?? null}
      pdfFileId={data.pdfFile?.id ?? null}
      pdfText={part.pdf_text}
      rates={data.rates}
      canWrite={data.canWrite}
      aiAvailable={env.hasAi()}
      assembly={assembly}
    />
  );
}
