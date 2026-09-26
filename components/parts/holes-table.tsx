"use client";

/**
 * HolesTable — holes grouped by diameter with the automatic thread
 * suggestion and a confirm select per group (size / no thread /
 * automatic). Confirmation is stored per hole loop id
 * (annotations.threads) — the group select applies to every hole of
 * that diameter in one action.
 * File path: /components/parts/holes-table.tsx
 */

import { useId } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Panel } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatMm, formatNumber } from "@/lib/format";
import type { HoleInfo, PartAnnotations } from "@/lib/geometry/types";
import { THREAD_TABLE } from "@/lib/geometry/threads";

export type ThreadChoice = { mode: "auto" } | { mode: "none" } | { mode: "size"; size: string };

export type HolesTableProps = {
  holes: HoleInfo[];
  threads: PartAnnotations["threads"];
  disabled?: boolean;
  onConfirm: (loopIds: string[], choice: ThreadChoice) => void;
};

type Group = { key: string; diameterMm: number; loopIds: string[]; suggestion: HoleInfo["thread"]; circular: boolean };

export function groupHoles(holes: HoleInfo[]): Group[] {
  const groups = new Map<string, Group>();
  for (const hole of holes) {
    const key = `${hole.diameterMm.toFixed(3)}|${hole.circular ? "c" : "n"}`;
    const group = groups.get(key) ?? { key, diameterMm: hole.diameterMm, loopIds: [], suggestion: hole.thread, circular: hole.circular };
    group.loopIds.push(hole.loopId);
    if (!group.suggestion && hole.thread) group.suggestion = hole.thread;
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => a.diameterMm - b.diameterMm);
}

function currentChoice(group: Group, threads: PartAnnotations["threads"]): string {
  const values = group.loopIds.map((id) => (id in threads ? threads[id] : undefined));
  const first = values[0];
  if (values.every((v) => v === first)) {
    if (first === undefined) return "__auto";
    if (first === null) return "__none";
    return first;
  }
  return "__mixed";
}

export function HolesTable({ holes, threads, disabled = false, onConfirm }: HolesTableProps) {
  const c = useContent();
  const locale = useLocale();
  const t = c.upload.part.holes;
  const id = useId();
  const groups = groupHoles(holes);

  return (
    <Panel title={c.upload.part.panels.holes} flush>
      {groups.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-text-muted">{t.empty}</p>
      ) : (
        <TableWrap>
          <Table dense>
            <thead>
              <tr>
                <Th align="num">{t.diameter}</Th>
                <Th align="num">{t.count}</Th>
                <Th>{t.thread}</Th>
                <Th>{t.confirm}</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const choice = currentChoice(group, threads);
                const sizes = Array.from(new Set([group.suggestion?.size, ...THREAD_TABLE.map((e) => e.size)].filter((s): s is string => Boolean(s))));
                return (
                  <tr key={group.key}>
                    <Td align="num">{formatMm(group.diameterMm, locale, 3)}</Td>
                    <Td align="num">{formatNumber(group.loopIds.length, locale)}</Td>
                    <Td>
                      {choice !== "__auto" && choice !== "__mixed" ? (
                        <StatusChip severity="green" label={choice === "__none" ? t.noThread : `${choice} · ${t.confirmed}`} />
                      ) : group.suggestion ? (
                        <StatusChip
                          severity="amber"
                          label={`${group.suggestion.size} · ${t.suggested}`}
                          title={`${t.matchedBy[group.suggestion.matchedBy]} ±${formatMm(group.suggestion.deviationMm, locale, 3)} mm`}
                        />
                      ) : (
                        <span className="text-text-faint">{group.circular ? t.noThread : t.nonCircular}</span>
                      )}
                    </Td>
                    <Td>
                      <label htmlFor={`${id}-${index}`} className="visually-hidden">
                        {t.confirm} Ø {formatMm(group.diameterMm, locale, 3)}
                      </label>
                      <select
                        id={`${id}-${index}`}
                        className="field field-sm field-inline"
                        disabled={disabled}
                        value={choice === "__mixed" ? "__auto" : choice}
                        onChange={(event) => {
                          const value = event.target.value;
                          const next: ThreadChoice = value === "__auto" ? { mode: "auto" } : value === "__none" ? { mode: "none" } : { mode: "size", size: value };
                          onConfirm(group.loopIds, next);
                        }}
                      >
                        <option value="__auto">{t.auto}{group.suggestion ? ` (${group.suggestion.size})` : ""}</option>
                        <option value="__none">{t.noThread}</option>
                        {sizes.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}
