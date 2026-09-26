"use client";

/**
 * Viewer — the per-tool side panels (.panel-dark) and the part-level
 * rolling dialog (Modal).
 * File path: /components/viewer/viewer-panels.tsx
 *
 * Panels own only their form state; every commit calls back into
 * PartViewer, which runs the pure reducer from lib/viewer/tools and
 * emits the next PartAnnotations. Forms use the shared primitives
 * (Field with the dark tone, NumberInput, Select, Button); the effective
 * weld length and the calibration factor are previewed with the same
 * pure helpers the reducers use, so what the panel shows is what gets
 * stored. Bend defaults: angle 90°, radius = thickness, die V optional.
 * The weld form is validated with weldFormIssue (same rule as the server
 * schema: stitch pitch > 0) — the pitch input floors at
 * STITCH_PITCH_MIN_MM, an invalid form shows a field error, previews "—"
 * and disables Add, so nothing the server would refuse is ever emitted.
 * Point-pick panels carry a typed X/Y entry (PointEntry) and a "clear
 * points" button: the keyboard route to a bend line, a weld by points or
 * a calibration (the canvas also picks the ends of the focused entity
 * with Enter — see lib/viewer/keyboard).
 */

import { useId, useState } from "react";
import { useContent, useLocale } from "@/components/providers/locale";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { Notice } from "@/components/ui/notice";
import { formatMm, formatNumber, interpolate } from "@/lib/format";
import type {
  Bbox,
  BendAnnotation,
  EntityRole,
  PartAnnotations,
  PartGeometry,
  Point,
  RollAnnotation,
  WeldAnnotation,
} from "@/lib/geometry/types";
import { detectAnnularSector, rollDimensions, rollPrefill } from "@/lib/viewer/cone";
import {
  JOIN_TOLERANCE_DEFAULT_MM,
  JOIN_TOLERANCE_MAX_MM,
  JOIN_TOLERANCE_MIN_MM,
  STITCH_PITCH_MIN_MM,
  TAG_ROLES,
  WELD_PROCESSES,
  bendDefaults,
  currentScaleFactor,
  previewWeldEffectiveLength,
  scalePreview,
  weldDefaults,
  weldFormIssue,
  type BendForm,
  type WeldForm,
} from "@/lib/viewer/tools";

/* ─── Shared chrome ──────────────────────────────────────── */

function ToolPanel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <aside className="panel-dark flex h-full flex-col" aria-label={title} data-tool-panel="true">
      <div className="panel-head" style={{ borderBottomColor: "var(--color-line-dark)" }}>
        <h3 className="panel-title" style={{ color: "var(--color-on-dark-muted)" }}>
          {title}
        </h3>
      </div>
      <div className="panel-body flex flex-col gap-4 text-[13.5px]">
        {hint && <p className="text-on-dark-soft">{hint}</p>}
        {children}
      </div>
    </aside>
  );
}

function DarkRow({ label, value, id }: { label: string; value: string; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-dark py-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-dark-muted">{label}</span>
      <span className="num font-bold text-white" data-readout={id}>
        {value}
      </span>
    </div>
  );
}

function PickedList({ points, label, onClear }: { points: readonly Point[]; label: string; onClear?: () => void }) {
  const c = useContent().viewer;
  const locale = useLocale();
  if (points.length === 0) return null;
  return (
    <div className="flex items-start justify-between gap-2">
      <ol className="mono text-[12px] text-on-dark-soft" aria-label={label}>
        {points.map((p, i) => (
          <li key={i}>
            {i + 1}. {formatMm(p.x, locale)} ; {formatMm(p.y, locale)}
          </li>
        ))}
      </ol>
      {onClear && (
        <button type="button" className="tool-btn h-7!" onClick={onClear} data-clear-picked="true">
          {c.point.clear}
        </button>
      )}
    </div>
  );
}

/** Typed X / Y point — the keyboard alternative to clicking on the canvas. */
function PointEntry({ onPick }: { onPick: (p: Point) => void }) {
  const c = useContent().viewer;
  const id = useId();
  const [x, setX] = useState<number | null>(null);
  const [y, setY] = useState<number | null>(null);
  const ready = x !== null && y !== null;
  const add = () => {
    if (!ready) return;
    onPick({ x, y });
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line-dark pt-3" data-point-entry="true">
      <span className="field-label" style={{ color: "var(--color-on-dark-muted)" }}>
        {c.point.title}
      </span>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label={`${c.point.x} (${c.units.mm})`} htmlFor={`${id}-x`} tone="dark">
          <NumberInput id={`${id}-x`} dense decimals={3} value={x} onValueChange={setX} onKeyDown={(e) => e.key === "Enter" && add()} />
        </Field>
        <Field label={`${c.point.y} (${c.units.mm})`} htmlFor={`${id}-y`} tone="dark">
          <NumberInput id={`${id}-y`} dense decimals={3} value={y} onValueChange={setY} onKeyDown={(e) => e.key === "Enter" && add()} />
        </Field>
        <Button type="button" variant="ghost-light" size="sm" disabled={!ready} onClick={add} data-add-point="true">
          {c.point.add}
        </Button>
      </div>
    </div>
  );
}

/* ─── Bend form (shared by tag + draw) ───────────────────── */

export function BendFormFields({ value, onChange, idPrefix }: { value: BendForm; onChange: (next: BendForm) => void; idPrefix: string }) {
  const c = useContent().viewer;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={`${c.bend.angle} (${c.units.deg})`} htmlFor={`${idPrefix}-angle`} tone="dark">
        <NumberInput
          id={`${idPrefix}-angle`}
          dense
          decimals={1}
          min={0}
          max={180}
          value={value.angleDeg}
          onValueChange={(v) => onChange({ ...value, angleDeg: v ?? value.angleDeg })}
        />
      </Field>
      <Field label={`${c.bend.radius} (${c.units.mm})`} htmlFor={`${idPrefix}-radius`} tone="dark">
        <NumberInput id={`${idPrefix}-radius`} dense decimals={2} min={0} value={value.radiusMm} onValueChange={(v) => onChange({ ...value, radiusMm: v })} />
      </Field>
      <Field label={c.bend.direction} htmlFor={`${idPrefix}-dir`} tone="dark">
        <Select id={`${idPrefix}-dir`} dense value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value === "down" ? "down" : "up" })}>
          <option value="up">{c.bend.up}</option>
          <option value="down">{c.bend.down}</option>
        </Select>
      </Field>
      <Field label={`${c.bend.dieV} (${c.units.mm})`} htmlFor={`${idPrefix}-die`} tone="dark" help={c.bend.dieVHelp}>
        <NumberInput id={`${idPrefix}-die`} dense decimals={1} min={0} value={value.dieVMm} onValueChange={(v) => onChange({ ...value, dieVMm: v })} />
      </Field>
    </div>
  );
}

/* ─── Tag ────────────────────────────────────────────────── */

export function TagPanel({
  selectedIds,
  thicknessMm,
  onTag,
  onClearTag,
}: {
  selectedIds: readonly string[];
  thicknessMm: number | null;
  onTag: (role: EntityRole, form?: BendForm) => void;
  onClearTag: () => void;
}) {
  const c = useContent().viewer;
  const id = useId();
  const [bendRole, setBendRole] = useState<"bend_up" | "bend_down" | null>(null);
  const [form, setForm] = useState<BendForm>(() => bendDefaults(thicknessMm));
  const count = selectedIds.length;
  return (
    <ToolPanel title={c.tag.title} hint={count === 0 ? c.tag.none : c.hints.tag}>
      <p className="chip chip-dark self-start" data-selection-count={count}>
        {interpolate(c.tag.selection, { count })}
      </p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={c.tag.title}>
        {TAG_ROLES.map((role) => {
          const isBend = role === "bend_up" || role === "bend_down";
          return (
            <Button
              key={role}
              type="button"
              variant="ghost-light"
              size="sm"
              disabled={count === 0}
              aria-pressed={isBend ? bendRole === role : undefined}
              onClick={() => {
                if (isBend) {
                  setBendRole(role);
                  setForm((f) => ({ ...f, direction: role === "bend_up" ? "up" : "down" }));
                } else {
                  setBendRole(null);
                  onTag(role);
                }
              }}
              data-role={role}
            >
              {c.roles[role]}
            </Button>
          );
        })}
      </div>
      {bendRole && (
        <div className="flex flex-col gap-3 border-t border-line-dark pt-3">
          <BendFormFields value={form} onChange={setForm} idPrefix={`${id}-tagbend`} />
          <Button type="button" variant="primary" size="sm" arrow disabled={count === 0} onClick={() => onTag(bendRole, form)}>
            {c.tag.apply}
          </Button>
        </div>
      )}
      <Button type="button" variant="ghost-light" size="sm" disabled={count === 0} onClick={onClearTag}>
        {c.tag.clearOverride}
      </Button>
    </ToolPanel>
  );
}

/* ─── Draw bend ──────────────────────────────────────────── */

export function BendPanel({
  picked,
  thicknessMm,
  bends,
  onAdd,
  onRemove,
  onPickPoint,
  onClearPicked,
}: {
  picked: readonly Point[];
  thicknessMm: number | null;
  bends: readonly BendAnnotation[];
  onAdd: (form: BendForm) => void;
  onRemove: (id: string) => void;
  /** Typed point (keyboard) — same pick rule as a click. */
  onPickPoint: (p: Point) => void;
  onClearPicked: () => void;
}) {
  const c = useContent().viewer;
  const locale = useLocale();
  const id = useId();
  const [form, setForm] = useState<BendForm>(() => bendDefaults(thicknessMm));
  const ready = picked.length === 2;
  const length = ready ? Math.hypot(picked[1].x - picked[0].x, picked[1].y - picked[0].y) : 0;
  const drawn = bends.filter((b) => b.entityId === null);
  return (
    <ToolPanel title={c.bend.title} hint={picked.length === 0 ? c.hints.bendFirst : c.hints.bendSecond}>
      <PickedList points={picked} label={c.bend.picked} onClear={onClearPicked} />
      <PointEntry onPick={onPickPoint} />
      <DarkRow label={c.bend.length} value={ready ? `${formatMm(length, locale)} ${c.units.mm}` : "—"} id="bend-length" />
      <BendFormFields value={form} onChange={setForm} idPrefix={`${id}-bend`} />
      <Button type="button" variant="primary" size="sm" arrow disabled={!ready} onClick={() => onAdd(form)}>
        {c.bend.add}
      </Button>
      <div>
        <h4 className="field-label" style={{ color: "var(--color-on-dark-muted)" }}>
          {c.bend.drawn}
        </h4>
        {drawn.length === 0 ? (
          <p className="text-on-dark-muted">{c.bend.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {drawn.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 border-b border-line-dark py-1 text-[12.5px]">
                <span className="num">
                  {formatMm(b.lengthMm, locale)} {c.units.mm} · {formatNumber(b.angleDeg, locale)}
                  {c.units.deg} · {b.direction === "down" ? c.bend.down : c.bend.up}
                </span>
                <button type="button" className="tool-btn h-7!" onClick={() => onRemove(b.id)} aria-label={`${c.bend.remove} ${b.id}`}>
                  {c.bend.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolPanel>
  );
}

/* ─── Weld ───────────────────────────────────────────────── */

export function WeldFormFields({ value, onChange, idPrefix }: { value: WeldForm; onChange: (next: WeldForm) => void; idPrefix: string }) {
  const c = useContent().viewer;
  const issue = weldFormIssue(value);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={c.weld.process} htmlFor={`${idPrefix}-process`} tone="dark">
        <Select id={`${idPrefix}-process`} dense value={value.process} onChange={(e) => onChange({ ...value, process: e.target.value as WeldForm["process"] })}>
          {WELD_PROCESSES.map((p) => (
            <option key={p} value={p}>
              {c.weld.processes[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`${c.weld.bead} (${c.units.mm})`} htmlFor={`${idPrefix}-bead`} tone="dark">
        <NumberInput id={`${idPrefix}-bead`} dense decimals={1} min={0} value={value.beadMm} onValueChange={(v) => onChange({ ...value, beadMm: v ?? value.beadMm })} />
      </Field>
      <Field label={c.weld.pattern} htmlFor={`${idPrefix}-pattern`} tone="dark">
        <Select id={`${idPrefix}-pattern`} dense value={value.pattern} onChange={(e) => onChange({ ...value, pattern: e.target.value === "stitch" ? "stitch" : "full" })}>
          <option value="full">{c.weld.full}</option>
          <option value="stitch">{c.weld.stitch}</option>
        </Select>
      </Field>
      <Field label={c.weld.sides} htmlFor={`${idPrefix}-sides`} tone="dark">
        <Select id={`${idPrefix}-sides`} dense value={String(value.sides)} onChange={(e) => onChange({ ...value, sides: e.target.value === "2" ? 2 : 1 })}>
          <option value="1">{c.weld.sidesOne}</option>
          <option value="2">{c.weld.sidesTwo}</option>
        </Select>
      </Field>
      {value.pattern === "stitch" && (
        <>
          <Field label={`${c.weld.beadLength} (${c.units.mm})`} htmlFor={`${idPrefix}-stitch-bead`} tone="dark">
            <NumberInput
              id={`${idPrefix}-stitch-bead`}
              dense
              decimals={1}
              min={0}
              value={value.stitch.beadLengthMm}
              onValueChange={(v) => onChange({ ...value, stitch: { ...value.stitch, beadLengthMm: v ?? value.stitch.beadLengthMm } })}
            />
          </Field>
          <Field label={`${c.weld.pitch} (${c.units.mm})`} htmlFor={`${idPrefix}-pitch`} tone="dark" error={issue === "pitch" ? c.weld.pitchRequired : null}>
            <NumberInput
              id={`${idPrefix}-pitch`}
              dense
              decimals={1}
              min={STITCH_PITCH_MIN_MM}
              invalid={issue === "pitch"}
              aria-describedby={issue === "pitch" ? `${idPrefix}-pitch-error` : undefined}
              value={value.stitch.pitchMm}
              onValueChange={(v) => onChange({ ...value, stitch: { ...value.stitch, pitchMm: v ?? value.stitch.pitchMm } })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

export function WeldPanel({
  mode,
  onModeChange,
  lengthMm,
  ready,
  picked,
  thicknessMm,
  welds,
  onAdd,
  onRemove,
  onPickPoint,
  onClearPicked,
}: {
  mode: "entities" | "points";
  onModeChange: (mode: "entities" | "points") => void;
  /** Geometric length of the current pick (selected chain or two points). */
  lengthMm: number;
  ready: boolean;
  picked: readonly Point[];
  thicknessMm: number | null;
  welds: readonly WeldAnnotation[];
  onAdd: (form: WeldForm) => void;
  onRemove: (id: string) => void;
  /** Typed point (keyboard) in "points" mode — same pick rule as a click. */
  onPickPoint: (p: Point) => void;
  onClearPicked: () => void;
}) {
  const c = useContent().viewer;
  const locale = useLocale();
  const id = useId();
  const [form, setForm] = useState<WeldForm>(() => weldDefaults(thicknessMm));
  const valid = weldFormIssue(form) === null;
  const effective = previewWeldEffectiveLength(form, lengthMm);
  return (
    <ToolPanel title={c.weld.title} hint={mode === "entities" ? c.hints.weldEntities : picked.length === 0 ? c.hints.weldPoints : c.hints.bendSecond}>
      <div className="toolbar" role="group" aria-label={c.weld.mode}>
        <button type="button" className="tool-btn" aria-pressed={mode === "entities"} onClick={() => onModeChange("entities")} data-weld-mode="entities">
          {c.weld.modeEntities}
        </button>
        <button type="button" className="tool-btn" aria-pressed={mode === "points"} onClick={() => onModeChange("points")} data-weld-mode="points">
          {c.weld.modePoints}
        </button>
      </div>
      {mode === "points" && <PickedList points={picked} label={c.bend.picked} onClear={onClearPicked} />}
      {mode === "points" && <PointEntry onPick={onPickPoint} />}
      <DarkRow label={c.weld.length} value={ready ? `${formatMm(lengthMm, locale)} ${c.units.mm}` : "—"} id="weld-length" />
      <DarkRow label={c.weld.effective} value={ready && effective !== null ? `${formatMm(effective, locale)} ${c.units.mm}` : "—"} id="weld-effective" />
      <WeldFormFields value={form} onChange={setForm} idPrefix={`${id}-weld`} />
      {!ready && <p className="text-on-dark-muted">{c.weld.needSelection}</p>}
      <Button type="button" variant="primary" size="sm" arrow disabled={!ready || !valid} onClick={() => valid && onAdd(form)} data-add-weld="true">
        {c.weld.add}
      </Button>
      <div>
        <h4 className="field-label" style={{ color: "var(--color-on-dark-muted)" }}>
          {c.weld.list}
        </h4>
        {welds.length === 0 ? (
          <p className="text-on-dark-muted">{c.weld.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {welds.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 border-b border-line-dark py-1 text-[12.5px]">
                <span className="num">
                  {c.weld.processes[w.process]} · {formatMm(w.lengthMm, locale)} → {formatMm(w.effectiveLengthMm, locale)} {c.units.mm}
                </span>
                <button type="button" className="tool-btn h-7!" onClick={() => onRemove(w.id)} aria-label={`${c.weld.remove} ${w.id}`}>
                  {c.weld.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolPanel>
  );
}

/* ─── Calibrate ──────────────────────────────────────────── */

export function CalibratePanel({
  picked,
  annotations,
  bbox,
  onApply,
  onReset,
  onPickPoint,
  onClearPicked,
}: {
  picked: readonly Point[];
  annotations: PartAnnotations;
  bbox: Bbox;
  onApply: (realMm: number) => void;
  onReset: () => void;
  /** Typed point (keyboard) — same pick rule as a click. */
  onPickPoint: (p: Point) => void;
  onClearPicked: () => void;
}) {
  const c = useContent().viewer;
  const locale = useLocale();
  const id = useId();
  const [real, setReal] = useState<number | null>(null);
  const ready = picked.length === 2;
  const preview = ready && real !== null ? scalePreview(annotations, picked[0], picked[1], real) : null;
  const measured = ready ? Math.hypot(picked[1].x - picked[0].x, picked[1].y - picked[0].y) : null;
  const factor = currentScaleFactor(annotations);
  return (
    <ToolPanel title={c.calibrate.title} hint={picked.length === 0 ? c.hints.calibrateFirst : c.hints.calibrateSecond}>
      <PickedList points={picked} label={c.bend.picked} onClear={onClearPicked} />
      <PointEntry onPick={onPickPoint} />
      <DarkRow label={c.calibrate.measured} value={measured !== null ? `${formatMm(measured, locale, 3)} ${c.units.mm}` : "—"} id="calibrate-measured" />
      <Field label={`${c.calibrate.real} (${c.units.mm})`} htmlFor={`${id}-real`} tone="dark">
        <NumberInput id={`${id}-real`} dense decimals={3} min={0} value={real} onValueChange={setReal} disabled={!ready} />
      </Field>
      <DarkRow label={c.calibrate.factor} value={preview ? `× ${formatNumber(preview.ratio, locale, { maximumFractionDigits: 4 })}` : "—"} id="calibrate-factor" />
      <DarkRow
        label={c.calibrate.resultBbox}
        value={preview ? `${formatMm(bbox.width * preview.ratio, locale)} × ${formatMm(bbox.height * preview.ratio, locale)} ${c.units.mm}` : "—"}
        id="calibrate-bbox"
      />
      <Button type="button" variant="primary" size="sm" arrow disabled={!preview} onClick={() => real !== null && onApply(real)}>
        {c.calibrate.apply}
      </Button>
      <div className="flex items-center justify-between gap-2 border-t border-line-dark pt-3">
        <span className="text-on-dark-soft" data-readout="scale-current">
          {annotations.scale ? interpolate(c.calibrate.current, { factor: formatNumber(factor, locale, { maximumFractionDigits: 4 }) }) : c.calibrate.none}
        </span>
        {annotations.scale && (
          <Button type="button" variant="ghost-light" size="sm" onClick={onReset}>
            {c.calibrate.reset}
          </Button>
        )}
      </div>
    </ToolPanel>
  );
}

/* ─── Clean-up ───────────────────────────────────────────── */

export function CleanupPanel({
  hasSelection,
  annotations,
  onKeepLargest,
  onDeleteSelection,
  onIgnoreSelection,
  onJoin,
  onMirror,
  onSplit,
  onRestoreDeleted,
}: {
  hasSelection: boolean;
  annotations: PartAnnotations;
  onKeepLargest: () => void;
  onDeleteSelection: () => void;
  onIgnoreSelection: () => void;
  onJoin: (toleranceMm: number) => void;
  onMirror: () => void;
  onSplit: () => void;
  onRestoreDeleted: () => void;
}) {
  const c = useContent().viewer;
  const id = useId();
  const [tol, setTol] = useState<number | null>(JOIN_TOLERANCE_DEFAULT_MM);
  const deleted = annotations.deletedEntityIds.length;
  return (
    <ToolPanel title={c.cleanup.title} hint={c.hints.cleanup}>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="ghost-light" size="sm" onClick={onKeepLargest} title={c.cleanup.keepLargestHelp}>
          {c.cleanup.keepLargest}
        </Button>
        <Button type="button" variant="ghost-light" size="sm" disabled={!hasSelection} onClick={onDeleteSelection} title={hasSelection ? undefined : c.cleanup.needSelection}>
          {c.cleanup.deleteSelection}
        </Button>
        <Button type="button" variant="ghost-light" size="sm" disabled={!hasSelection} onClick={onIgnoreSelection} title={hasSelection ? undefined : c.cleanup.needSelection}>
          {c.cleanup.ignoreSelection}
        </Button>
        {deleted > 0 && (
          <Button type="button" variant="ghost-light" size="sm" onClick={onRestoreDeleted}>
            {c.cleanup.restoreDeleted} ({interpolate(c.cleanup.deletedCount, { count: deleted })})
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-line-dark pt-3">
        <Field label={`${c.cleanup.join} — ${c.cleanup.joinTolerance} (${c.units.mm})`} htmlFor={`${id}-tol`} tone="dark" help={c.cleanup.joinHelp}>
          <NumberInput id={`${id}-tol`} dense decimals={3} min={JOIN_TOLERANCE_MIN_MM} max={JOIN_TOLERANCE_MAX_MM} value={tol} onValueChange={setTol} />
        </Field>
        <Button type="button" variant="ghost-light" size="sm" disabled={tol === null || tol <= 0} onClick={() => tol !== null && onJoin(tol)}>
          {c.cleanup.joinApply}
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-line-dark pt-3">
        <Button type="button" variant="ghost-light" size="sm" aria-pressed={annotations.mirrored} onClick={onMirror} title={annotations.mirrored ? c.cleanup.mirrorOn : undefined}>
          {c.cleanup.mirror}
        </Button>
        <Button type="button" variant="ghost-light" size="sm" onClick={onSplit} title={c.cleanup.splitHelp}>
          {c.cleanup.split}
        </Button>
      </div>
    </ToolPanel>
  );
}

/* ─── Rolling dialog ─────────────────────────────────────── */

export function RollDialog({
  open,
  geometry,
  annotations,
  onSave,
  onClear,
  onClose,
}: {
  open: boolean;
  geometry: PartGeometry;
  annotations: PartAnnotations;
  onSave: (roll: RollAnnotation) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const content = useContent();
  const c = content.viewer;
  const locale = useLocale();
  const id = useId();
  const [form, setForm] = useState<RollAnnotation>(() => rollPrefill(geometry, annotations.roll));
  const [inputMode, setInputMode] = useState<"radius" | "diameter">("radius");
  const cone = detectAnnularSector(geometry);
  const valid = form.radiusMm > 0 && form.arcAngleDeg > 0;
  const bbox = geometry.measures.bbox;
  const setAxis = (axis: "x" | "y") => setForm((f) => ({ ...f, axis, ...(f.cone ? {} : rollDimensions(bbox, axis)) }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c.roll.title}
      size="md"
      footer={
        <>
          {annotations.roll && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              {c.roll.clear}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {content.common.actions.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" arrow disabled={!valid} onClick={() => valid && onSave(form)}>
            {c.roll.apply}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13.5px] text-text-muted">{c.roll.hint}</p>
        {cone ? (
          <Notice tone="success" role="status">
            {c.roll.coneDetected}: {c.roll.coneInner} {formatMm(cone.innerRadiusMm, locale)} {c.units.mm}, {c.roll.coneOuter} {formatMm(cone.outerRadiusMm, locale)} {c.units.mm}, {c.roll.coneSweep}{" "}
            {formatNumber(cone.sweepDeg, locale)}
            {c.units.deg}
          </Notice>
        ) : (
          <Notice tone="info" role="status">
            {c.roll.coneNone}
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={c.roll.inputMode} htmlFor={`${id}-mode`}>
            <Select id={`${id}-mode`} dense value={inputMode} onChange={(e) => setInputMode(e.target.value === "diameter" ? "diameter" : "radius")}>
              <option value="radius">{c.roll.radius}</option>
              <option value="diameter">{c.roll.diameter}</option>
            </Select>
          </Field>
          <Field
            label={`${inputMode === "radius" ? c.roll.radius : c.roll.diameter} (${c.units.mm})`}
            htmlFor={`${id}-radius`}
            error={form.radiusMm > 0 ? null : c.roll.radiusRequired}
          >
            <NumberInput
              id={`${id}-radius`}
              dense
              decimals={2}
              min={0}
              value={inputMode === "radius" ? form.radiusMm : form.radiusMm * 2}
              onValueChange={(v) => setForm((f) => ({ ...f, radiusMm: v === null ? 0 : inputMode === "radius" ? v : v / 2 }))}
            />
          </Field>
          <Field label={c.roll.axis} htmlFor={`${id}-axis`}>
            <Select id={`${id}-axis`} dense value={form.axis} onChange={(e) => setAxis(e.target.value === "y" ? "y" : "x")}>
              <option value="x">{c.roll.axisX}</option>
              <option value="y">{c.roll.axisY}</option>
            </Select>
          </Field>
          <Field label={`${c.roll.arcAngle} (${c.units.deg})`} htmlFor={`${id}-angle`}>
            <NumberInput id={`${id}-angle`} dense decimals={1} min={0} max={360} value={form.arcAngleDeg} onValueChange={(v) => setForm((f) => ({ ...f, arcAngleDeg: v ?? f.arcAngleDeg }))} />
          </Field>
          <Field label={`${c.roll.axisLength} (${c.units.mm})`} htmlFor={`${id}-axis-len`}>
            <NumberInput id={`${id}-axis-len`} dense decimals={1} min={0} value={form.axisLengthMm} onValueChange={(v) => setForm((f) => ({ ...f, axisLengthMm: v ?? f.axisLengthMm }))} />
          </Field>
          <Field label={`${c.roll.developedWidth} (${c.units.mm})`} htmlFor={`${id}-dev`}>
            <NumberInput id={`${id}-dev`} dense decimals={1} min={0} value={form.developedWidthMm} onValueChange={(v) => setForm((f) => ({ ...f, developedWidthMm: v ?? f.developedWidthMm }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
