/**
 * GET /api/parts/[id]/export-dxf — the annotated DXF (layers CUT / HOLES /
 * BEND_UP / BEND_DOWN / WELD / ENGRAVE / IGNORE) as a text/plain
 * attachment "<name>-annotated.dxf".
 * File path: /app/api/parts/[id]/export-dxf/route.ts
 *
 * Any signed-in role (the export is a read). Generated on the fly from
 * parts.geometry + parts.annotations by the geometry engine; nothing is
 * stored.
 */

import { NextResponse, type NextRequest } from "next/server";
import { geometryEngine } from "@/lib/geometry";
import { accessErrorResponse, requirePartReader } from "@/lib/parts/access";
import { parseStoredGeometry } from "@/lib/parts/intake-db";
import { parseStoredAnnotations } from "@/lib/parts/schema";
import { safeFileName } from "@/lib/files/sniff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const { part } = await requirePartReader(id);
    const geometry = parseStoredGeometry(part.geometry);
    if (!geometry) return NextResponse.json({ error: "no_geometry" }, { status: 409 });
    const dxf = await geometryEngine.exportAnnotatedDxf(geometry, parseStoredAnnotations(part.annotations));
    const base = safeFileName(`${part.name}.dxf`).replace(/\.dxf$/i, "");
    return new NextResponse(dxf, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}-annotated.dxf"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    const response = accessErrorResponse(error);
    if (response) return response;
    console.error("[parts/export-dxf] failed", error);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
