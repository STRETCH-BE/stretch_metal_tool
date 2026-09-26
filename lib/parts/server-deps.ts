/**
 * Production ReanalyseDeps — the geometry engine, SVG thumbnails, Storage
 * download and the SHA-256 geometry cache lookup, bound to a Supabase
 * client. SERVER ONLY; shared by the part actions and the part page.
 * File path: /lib/parts/server-deps.ts
 *
 * Cache rule (build prompt Step 3 "results cached by SHA-256"): another
 * DXF part with the same file_hash, the same healing tolerance and
 * base-equivalent annotations (no scale / mirror / deletions) holds the
 * same base analysis, so its stored geometry is copied instead of
 * re-parsing the file; applyAnnotations then re-measures it with THIS
 * part's material, name and PDF text.
 */

import { geometryEngine, geometryToSvg } from "@/lib/geometry";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { downloadFile } from "@/lib/files/storage";
import { parseStoredGeometry } from "./intake-db";
import { parseStoredAnnotations } from "./schema";
import { isBaseEquivalent, type ReanalyseDeps } from "./reanalyse";

export function makeReanalyseDeps(client: ServerSupabase | AdminSupabase): ReanalyseDeps {
  return {
    analyse: (text, options) => geometryEngine.analyzeDxf(text, options),
    applyAnnotations: (geometry, annotations, options) => geometryEngine.applyAnnotations(geometry, annotations, options),
    toSvg: (geometry, annotations, size) => geometryToSvg(geometry, annotations, { ...size, theme: "light" }),
    download: async (path) => new Uint8Array(await downloadFile(path)),
    findCachedGeometry: async (fileHash, toleranceMm, excludePartId) => {
      const { data, error } = await client
        .from("parts")
        .select("id, source, geometry, annotations")
        .eq("file_hash", fileHash)
        .neq("id", excludePartId)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(`parts cache lookup: ${error.message}`);
      for (const row of data ?? []) {
        if (row.source !== "dxf") continue;
        const geometry = parseStoredGeometry(row.geometry);
        if (!geometry || Math.abs(geometry.healing.toleranceMm - toleranceMm) > 1e-9) continue;
        if (!isBaseEquivalent(parseStoredAnnotations(row.annotations))) continue;
        return geometry;
      }
      return null;
    },
  };
}
