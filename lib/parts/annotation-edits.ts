/**
 * Pure reducers over PartAnnotations for the one-click answers and the
 * table edits on the part page (triage answers, thread confirmation, bend
 * parameters, accepting PDF/AI suggestions).
 * File path: /lib/parts/annotation-edits.ts
 *
 * Every function returns a NEW annotations object and never touches the
 * geometry; the server action then runs applyAnnotations and stores the
 * result. Decisions:
 * - "These N lines: bend up / down / ignore / cut" writes a role override
 *   for every id in `triage.candidateEntityIds` (all candidates at once —
 *   individual tagging is the viewer's job).
 * - Bend parameters live on BendAnnotations. lib/pricing resolves bends
 *   from `annotations.bends` when that list is non-empty, else from the
 *   layer bend lines, so editing ONE bend materialises EVERY current bend
 *   line (layer, drawn or tagged) as an annotation with defaults (90°,
 *   radius = thickness, its own direction) — otherwise the other bends
 *   would silently drop out of the price.
 * - Thread confirmation: `null` means "no thread" (the automatic
 *   suggestion is overridden); accepting a PDF thread list confirms every
 *   hole whose diameter matches the size (lib/geometry threadForSize).
 */

import type {
  BendAnnotation,
  BendLine,
  HoleInfo,
  PartAnnotations,
  PartGeometry,
  Triage,
} from "@/lib/geometry/types";
import { THREAD_MATCH_TOLERANCE_MM, threadForSize } from "@/lib/geometry/threads";
import { normalizeThreadSize } from "@/lib/ai/threads";
import type { ThreadSuggestion as AiThreadSuggestion, BendSuggestion, FinishCode } from "@/lib/ai/types";
import type { ExtraOperation } from "@/lib/pricing/types";
import type { BendParams, CandidateRole, TriageAnswer } from "./schema";

export function applyTriageAnswer(
  annotations: PartAnnotations,
  triage: Pick<Triage, "candidateEntityIds"> | null,
  answer: TriageAnswer
): PartAnnotations {
  switch (answer.kind) {
    case "candidates":
      return tagCandidates(annotations, triage?.candidateEntityIds ?? [], answer.role);
    case "units":
      return { ...annotations, unitsConfirmed: true };
    case "forming":
      return { ...annotations, forming: answer.value };
  }
}

export function tagCandidates(annotations: PartAnnotations, ids: string[], role: CandidateRole): PartAnnotations {
  const entities = { ...annotations.entities };
  for (const id of ids) entities[id] = { role };
  return { ...annotations, entities };
}

/** Confirm (size) or reject (null) the thread on one hole loop. */
export function confirmThread(annotations: PartAnnotations, loopId: string, size: string | null): PartAnnotations {
  return { ...annotations, threads: { ...annotations.threads, [loopId]: size } };
}

/** Remove a confirmation so the automatic suggestion shows again. */
export function clearThread(annotations: PartAnnotations, loopId: string): PartAnnotations {
  const threads = { ...annotations.threads };
  delete threads[loopId];
  return { ...annotations, threads };
}

function bendFromLine(line: BendLine, thicknessMm: number | null): BendAnnotation {
  return {
    id: line.id,
    entityId: line.entityId,
    start: line.start,
    end: line.end,
    lengthMm: line.lengthMm,
    angleDeg: 90,
    radiusMm: thicknessMm,
    direction: line.direction === "down" ? "down" : "up",
    dieVMm: null,
  };
}

/** Every bend the pricing engine would see, as annotations (existing ones kept). */
export function materialiseBends(
  annotations: PartAnnotations,
  geometry: Pick<PartGeometry, "measures"> | null,
  thicknessMm: number | null
): BendAnnotation[] {
  if (annotations.bends.length > 0) return annotations.bends.map((b) => ({ ...b }));
  const lines = geometry?.measures.bendLines ?? [];
  const deleted = new Set(annotations.deletedEntityIds);
  return lines
    .filter((l) => l.source !== "candidate" && !deleted.has(l.id) && !(l.entityId && deleted.has(l.entityId)))
    .map((l) => bendFromLine(l, thicknessMm));
}

export function setBendParams(
  annotations: PartAnnotations,
  geometry: Pick<PartGeometry, "measures"> | null,
  bendId: string,
  params: BendParams,
  thicknessMm: number | null
): PartAnnotations | null {
  const bends = materialiseBends(annotations, geometry, thicknessMm);
  const index = bends.findIndex((b) => b.id === bendId);
  if (index < 0) return null;
  bends[index] = { ...bends[index], angleDeg: params.angleDeg, radiusMm: params.radiusMm, direction: params.direction };
  return { ...annotations, bends };
}

/** Confirms every unconfirmed hole whose diameter matches one of the suggested sizes. */
export function acceptThreadSuggestions(
  annotations: PartAnnotations,
  holes: HoleInfo[],
  suggested: AiThreadSuggestion[]
): { annotations: PartAnnotations; confirmed: number } {
  const sizes = Array.from(
    new Set(suggested.map((t) => normalizeThreadSize(t.size) ?? t.size.trim().toUpperCase()).filter((s) => s.length > 0))
  );
  const threads = { ...annotations.threads };
  let confirmed = 0;
  for (const hole of holes) {
    if (hole.loopId in threads && threads[hole.loopId] !== null) continue;
    const match = sizes.find((size) => {
      const suggestion = threadForSize(size, hole.diameterMm);
      return suggestion !== null && suggestion.deviationMm <= THREAD_MATCH_TOLERANCE_MM;
    });
    if (match) {
      threads[hole.loopId] = match;
      confirmed += 1;
    }
  }
  return { annotations: { ...annotations, threads }, confirmed };
}

/**
 * Applies suggested bend angles to the current bend lines: one angle →
 * every bend; N angles for N bends → in order; otherwise nothing (null).
 */
export function acceptBendSuggestion(
  annotations: PartAnnotations,
  geometry: Pick<PartGeometry, "measures"> | null,
  suggestion: BendSuggestion,
  thicknessMm: number | null
): PartAnnotations | null {
  const bends = materialiseBends(annotations, geometry, thicknessMm);
  if (bends.length === 0) return null;
  const angles = suggestion.angles.filter((a) => Number.isFinite(a) && a > 0 && a < 180);
  if (angles.length === 0) return null;
  const directions = suggestion.directions ?? [];
  const next = bends.map((b, i) => {
    const angle = angles.length === 1 ? angles[0] : angles.length === bends.length ? angles[i] : null;
    if (angle === null) return b;
    const direction = directions.length === bends.length ? directions[i] : b.direction;
    return { ...b, angleDeg: angle, direction };
  });
  if (angles.length !== 1 && angles.length !== bends.length) return null;
  return { ...annotations, bends: next };
}

/** AI finish code → rate_finish code (seed.sql: powder / zinc / deburr / engrave). */
export function finishRateCodeFor(code: FinishCode): string | null {
  switch (code) {
    case "powder_coating":
    case "painted":
      return "powder";
    case "galvanised":
      return "zinc";
    case "deburred":
      return "deburr";
    case "none":
      return null;
    default:
      return code;
  }
}

/** Adds a finish extra for the suggestion unless one with that code exists. */
export function acceptFinishSuggestion(
  extras: ExtraOperation[],
  finish: { code: FinishCode | null; ral: string | null; text: string | null }
): { extras: ExtraOperation[]; added: boolean } {
  const code = finish.code ? finishRateCodeFor(finish.code) : null;
  if (!code) return { extras, added: false };
  const exists = extras.some((e) => e.type === "finish" && e.code.toLowerCase() === code.toLowerCase());
  if (exists) return { extras, added: false };
  const noteParts = [finish.ral ? `RAL ${finish.ral}` : null, finish.text].filter((s): s is string => Boolean(s));
  const extra: ExtraOperation = { type: "finish", code, maskingMinutes: 0, note: noteParts.length ? noteParts.join(" — ") : null };
  return { extras: [...extras, extra], added: true };
}
