/**
 * Pure builder of the parts-row columns for a quick (manual) part, shared
 * by createQuickPart for both the insert and the "replace a red / STEP
 * part" update.
 * File path: /lib/parts/quick-part-columns.ts
 *
 * On replace the part becomes source "manual": file_id is kept (the
 * original stays downloadable) but file_hash is NULLED — the SHA-256
 * lookups (annotation restore on re-upload, base-geometry cache) key on
 * file_hash, and a quick part's synthetic rectangle + bends must never be
 * restored onto the real drawing when the same DXF is uploaded again.
 */

import { geometryToSvg, quickPart } from "@/lib/geometry";
import type { PartAnnotations, PartGeometry } from "@/lib/geometry/types";
import type { Json } from "@/lib/db/types";
import { THUMBNAIL_SIZE } from "./reanalyse";
import { quickPartInputFrom, type QuickPartForm } from "./schema";

export type QuickPartMaterial = { code: string; densityKgM3: number };

export type QuickPartColumns = {
  name: string;
  source: "manual";
  material_code: string | null;
  thickness_mm: number;
  geometry: Json;
  annotations: Json;
  triage: Json;
  thumbnail_svg: string;
  /** Present (null) only when replacing an existing part. */
  file_hash?: null;
};

export type QuickPartBuild = { columns: QuickPartColumns; geometry: PartGeometry; annotations: PartAnnotations };

export function buildQuickPartColumns(
  form: QuickPartForm,
  material: QuickPartMaterial | null,
  blankMarginMm: number,
  mode: "create" | "replace"
): QuickPartBuild {
  const input = quickPartInputFrom(form, material?.densityKgM3 ?? null, blankMarginMm);
  const { geometry, annotations } = quickPart(input);
  const thumbnailSvg = geometryToSvg(geometry, annotations, { ...THUMBNAIL_SIZE, theme: "light" });
  const columns: QuickPartColumns = {
    name: form.name,
    source: "manual",
    material_code: material?.code ?? form.materialCode,
    thickness_mm: form.thicknessMm,
    geometry: geometry as unknown as Json,
    annotations: annotations as unknown as Json,
    triage: geometry.triage as unknown as Json,
    thumbnail_svg: thumbnailSvg,
  };
  if (mode === "replace") columns.file_hash = null;
  return { columns, geometry, annotations };
}
