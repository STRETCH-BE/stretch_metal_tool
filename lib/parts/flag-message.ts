/**
 * Pure message helpers for feasibility flags, triage states, healing
 * reports and dropped entities — content lookup + `{param}` interpolation.
 * File path: /lib/parts/flag-message.ts
 *
 * Client- and server-safe (no Next, no Supabase): the part page panels,
 * the upload results and the quote builder (which may reuse it) all call
 * these with the FlagsContent of the current locale.
 *
 * Decisions:
 * - Numbers are formatted per locale when one is given (PL "2 224,5",
 *   max 2 decimals) so a message never shows "2224.5000000001".
 * - Code-valued params are translated before interpolation: `state`
 *   (TriageState → triage label), `family` (material family), `reason`
 *   (laser lookup reason), `what` (tube limit kind), `process` (weld
 *   process). Unknown codes fall through unchanged.
 * - `seamId` doubles as `weldId` (welding-only seams share the message).
 * - A placeholder with no value renders as "—" rather than leaking the
 *   raw `{key}` into the UI.
 */

import type { Flag, FlagCode } from "@/lib/pricing/types";
import type { DroppedEntity, HealingReport, Triage, TriageState } from "@/lib/geometry/types";
import type { FlagsContent } from "@/content/flags";
import { formatNumber, type Locale } from "@/lib/format";

export type FlagLike = { code: FlagCode; params?: Record<string, string | number> };

type Params = Record<string, string | number>;

function formatParam(value: string | number, locale?: Locale): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return locale ? formatNumber(value, locale, { maximumFractionDigits: 2 }) : String(value);
  }
  return value;
}

/** interpolate() variant: missing keys → "—", numbers formatted per locale. */
export function fillTemplate(template: string, params: Params, locale?: Locale): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? formatParam(params[key], locale) : "—"
  );
}

function lookup<K extends string>(map: Record<K, string>, value: string | number): string | number {
  return typeof value === "string" && value in map ? map[value as K] : value;
}

/** Translates enum-valued params to their labels; keeps everything else. */
export function translateParams(content: FlagsContent, params: Params): Params {
  const out: Params = { ...params };
  if ("state" in out && typeof out.state === "string" && out.state in content.triage) {
    out.state = content.triage[out.state as TriageState].label;
  }
  if ("family" in out) out.family = lookup(content.families, out.family);
  if ("reason" in out) out.reason = lookup(content.laserReasons, out.reason);
  if ("what" in out) out.what = lookup(content.tubeLimits, out.what);
  if ("process" in out) out.process = lookup(content.weldProcesses, out.process);
  if (!("weldId" in out) && "seamId" in out) out.weldId = out.seamId;
  return out;
}

/** Localised message of a pricing flag (label + interpolated message). */
export function flagMessage(content: FlagsContent, flag: FlagLike, locale?: Locale): string {
  const entry = content.flags[flag.code];
  if (!entry) return flag.code;
  return fillTemplate(entry.message, translateParams(content, flag.params ?? {}), locale);
}

export function flagLabel(content: FlagsContent, flag: FlagLike): string {
  return content.flags[flag.code]?.label ?? flag.code;
}

export function severityLabel(content: FlagsContent, severity: Flag["severity"]): string {
  return content.severity[severity];
}

/** Triage state → chip label. */
export function triageLabel(content: FlagsContent, state: TriageState): string {
  return content.triage[state].label;
}

/** Triage state → explanation with `triage.details` interpolated. */
export function triageMessage(content: FlagsContent, triage: Pick<Triage, "state" | "details">, locale?: Locale): string {
  return fillTemplate(content.triage[triage.state].message, triage.details, locale);
}

export function triageAction(content: FlagsContent, state: TriageState): string | null {
  return content.triage[state].action ?? null;
}

/** Reason codes → one sentence each, `triage.details` interpolated. */
export function triageReasons(content: FlagsContent, triage: Pick<Triage, "reasons" | "details">, locale?: Locale): string[] {
  return triage.reasons.map((code) => fillTemplate(content.triageReasons[code] ?? code, triage.details, locale));
}

export function triageSeverity(state: TriageState): "green" | "amber" | "red" {
  if (state === "green") return "green";
  return state.startsWith("amber") ? "amber" : "red";
}

/** "joined 3 gaps, removed 2 duplicates, flattened 1 spline" (only non-zero counters). */
export function healingSentence(content: FlagsContent, report: HealingReport, locale?: Locale): string {
  const p = content.healing.parts;
  const fragments: [string, number][] = [
    [p.gaps, report.gapsJoined],
    [p.duplicates, report.duplicatesRemoved],
    [p.overlaps, report.overlapsRemoved],
    [p.zeroLength, report.zeroLengthRemoved],
    [p.splines, report.splinesFlattened],
    [p.ellipses, report.ellipsesFlattened],
    [p.blocks, report.blocksExploded],
    [p.loopsClosed, report.loopsClosed],
  ];
  const parts = fragments.filter(([, count]) => count > 0).map(([tpl, count]) => fillTemplate(tpl, { count }, locale));
  if (parts.length === 0) return content.healing.nothing;
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function healingTolerance(content: FlagsContent, report: HealingReport, locale?: Locale): string {
  return fillTemplate(content.healing.tolerance, { toleranceMm: report.toleranceMm }, locale);
}

/** One line per dropped entity group, aggregated by type + reason (layers joined). */
export function droppedSummary(content: FlagsContent, dropped: DroppedEntity[], locale?: Locale): string[] {
  const groups = new Map<string, { type: string; reason: DroppedEntity["reason"]; count: number; layers: Set<string> }>();
  for (const d of dropped) {
    const key = `${d.type}|${d.reason}`;
    const group = groups.get(key) ?? { type: d.type, reason: d.reason, count: 0, layers: new Set<string>() };
    group.count += d.count;
    group.layers.add(d.layer);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .map((g) =>
      fillTemplate(
        content.dropped.item,
        {
          type: g.type,
          count: g.count,
          layer: Array.from(g.layers).sort().join(", "),
          reason: content.dropped.reasons[g.reason] ?? g.reason,
        },
        locale
      )
    );
}
