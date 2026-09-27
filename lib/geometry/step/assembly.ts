/**
 * Geometry engine — STEP assemblies: which product each solid belongs to,
 * how often it occurs, and one STEP file per solid.
 * File path: /lib/geometry/step/assembly.ts
 *
 * AP203 / AP214 product structure, as exporters write it:
 *   PRODUCT ← PRODUCT_DEFINITION_FORMATION ← PRODUCT_DEFINITION
 *     ← PRODUCT_DEFINITION_SHAPE ← SHAPE_DEFINITION_REPRESENTATION → *_SHAPE_REPRESENTATION → items (solids)
 *   NEXT_ASSEMBLY_USAGE_OCCURRENCE(parent PRODUCT_DEFINITION, child PRODUCT_DEFINITION)
 * gives the part name of a MANIFOLD_SOLID_BREP and the number of times
 * its product is placed in a parent (= quantity on the quote). Placement
 * transforms are not applied: each solid is analysed in its own frame.
 *
 * Splitting copies the original statements verbatim (part21 keeps each
 * instance's character span), so the per-part file holds exactly the
 * exporter's geometry: everything reachable from the solid plus the
 * representation context (units), wrapped in a fresh
 * ADVANCED_BREP_SHAPE_REPRESENTATION. Instance ids are kept, which also
 * makes the derived file easy to compare with the source.
 */

import { asRef, asRefs, asString, isList, isRef, isTyped, part, type StepFile, type StepInstance, type StepValue } from "./part21";

export type StepBodyInfo = {
  solidId: number;
  /** Product name (PRODUCT.name, else PRODUCT.id), or null when the solid has no product. */
  name: string | null;
  /** Placements of the product in its parent assembly (≥ 1). */
  occurrences: number;
  /** The representation the solid belongs to and its geometric context. */
  representationId: number | null;
  contextId: number | null;
};

const SOLID_TYPES = ["MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "FACETED_BREP"];

function isShapeRepresentation(inst: StepInstance): boolean {
  if (inst.type.endsWith("SHAPE_REPRESENTATION")) return true;
  return inst.complex.some((p) => p.type.endsWith("SHAPE_REPRESENTATION"));
}

function representationArgs(inst: StepInstance): StepValue[] | null {
  if (inst.type) return inst.args;
  const p = inst.complex.find((c) => c.type.endsWith("SHAPE_REPRESENTATION")) ?? inst.complex.find((c) => c.type === "REPRESENTATION");
  return p ? p.args : null;
}

/** Product name and occurrence count for every solid in the file, by solid id. */
export function stepBodyInfos(file: StepFile): Map<number, StepBodyInfo> {
  const inst = (id: number | null): StepInstance | null => (id === null ? null : (file.instances.get(id) ?? null));

  // Solid → representation (+ context).
  const repOfSolid = new Map<number, { representationId: number; contextId: number | null }>();
  for (const candidate of file.instances.values()) {
    if (!isShapeRepresentation(candidate)) continue;
    const args = representationArgs(candidate);
    if (!args) continue;
    const contextId = asRef(args[2]);
    for (const itemRef of asRefs(args[1])) {
      const item = inst(itemRef);
      if (item && SOLID_TYPES.some((t) => part(item, t))) repOfSolid.set(itemRef, { representationId: candidate.id, contextId });
    }
  }

  // Representation → product definition → product name.
  const productOfRep = new Map<number, { name: string | null; definitionId: number | null }>();
  for (const sdrId of file.byType.get("SHAPE_DEFINITION_REPRESENTATION") ?? []) {
    const sdr = inst(sdrId);
    if (!sdr) continue;
    const repId = asRef(sdr.args[1]);
    const pds = inst(asRef(sdr.args[0]));
    const definition = pds ? inst(asRef(pds.args[2])) : null;
    const formation = definition ? inst(asRef(definition.args[2])) : null;
    const product = formation ? inst(asRef(formation.args[2])) : null;
    let name: string | null = null;
    if (product) {
      const n = (asString(product.args[1]) ?? "").trim();
      const id = (asString(product.args[0]) ?? "").trim();
      name = n || id || null;
    }
    if (repId !== null) productOfRep.set(repId, { name, definitionId: definition?.id ?? null });
  }

  // Occurrences per child product definition.
  const occurrences = new Map<number, number>();
  for (const id of file.byType.get("NEXT_ASSEMBLY_USAGE_OCCURRENCE") ?? []) {
    const nauo = inst(id);
    const child = nauo ? asRef(nauo.args[4]) : null;
    if (child !== null) occurrences.set(child, (occurrences.get(child) ?? 0) + 1);
  }

  const out = new Map<number, StepBodyInfo>();
  for (const [solidId, rep] of repOfSolid) {
    const product = productOfRep.get(rep.representationId) ?? null;
    const count = product?.definitionId !== null && product?.definitionId !== undefined ? (occurrences.get(product.definitionId) ?? 1) : 1;
    out.set(solidId, {
      solidId,
      name: product?.name ?? null,
      occurrences: Math.max(1, count),
      representationId: rep.representationId,
      contextId: rep.contextId,
    });
  }
  return out;
}

function collectRefs(value: StepValue, into: number[]): void {
  if (isRef(value)) into.push(value.ref);
  else if (isList(value)) for (const v of value) collectRefs(v, into);
  else if (isTyped(value)) for (const v of value.args) collectRefs(v, into);
}

/** Every instance reachable from `roots` through argument references (the roots included). */
export function reachableInstances(file: StepFile, roots: number[]): Set<number> {
  const seen = new Set<number>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop() as number;
    if (seen.has(id)) continue;
    const inst = file.instances.get(id);
    if (!inst) continue;
    seen.add(id);
    const refs: number[] = [];
    for (const a of inst.args) collectRefs(a, refs);
    for (const p of inst.complex) for (const a of p.args) collectRefs(a, refs);
    for (const r of refs) if (!seen.has(r)) stack.push(r);
  }
  return seen;
}

function escape(s: string): string {
  return s.replace(/'/g, "''").replace(/[^\x20-\x7E]/g, (ch) => `\\X2\\${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}\\X0\\`);
}

/**
 * A STEP file holding one solid of `text` with its context, statements
 * copied verbatim. `info` comes from stepBodyInfos(); a solid without a
 * representation gets the file's first geometric context.
 */
export function extractBodyStep(text: string, file: StepFile, solidId: number, name: string, info: StepBodyInfo | null): string {
  let contextId = info?.contextId ?? null;
  if (contextId === null) {
    const ctx = file.byType.get("GEOMETRIC_REPRESENTATION_CONTEXT") ?? [];
    contextId = ctx.length ? ctx[0] : null;
  }
  const roots = contextId === null ? [solidId] : [solidId, contextId];
  const ids = Array.from(reachableInstances(file, roots)).sort((a, b) => a - b);
  let maxId = 0;
  const statements: string[] = [];
  for (const id of ids) {
    const inst = file.instances.get(id);
    if (!inst) continue;
    if (id > maxId) maxId = id;
    statements.push(text.slice(inst.span[0], inst.span[1]));
  }
  const repId = maxId + 1;
  const schema = file.header.schema ?? "AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }";
  const system = file.header.originatingSystem ?? "";
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('${escape(name)} — split from ${escape(file.header.fileName ?? "assembly")} by StretchMetal'),'2;1');`,
    `FILE_NAME('${escape(name)}.step','2026-01-01T00:00:00',(''),(''),'${escape(system)}','StretchMetal quoting tool','');`,
    `FILE_SCHEMA(('${escape(schema)}'));`,
    "ENDSEC;",
    "DATA;",
  ];
  const representation = `#${repId} = ADVANCED_BREP_SHAPE_REPRESENTATION('${escape(name)}',(#${solidId}),${contextId === null ? "$" : `#${contextId}`});`;
  return [...header, ...statements, representation, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
