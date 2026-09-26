"use client";

/**
 * Dropzone — drag-and-drop area with a keyboard path: a real <button>
 * opens the hidden file input, so Tab → Enter picks files without a
 * mouse. Multiple files; the accept list mirrors lib/files/sniff.ts.
 * File path: /components/intake/dropzone.tsx
 *
 * Visual states through .dropzone[data-active] (drag over). The whole
 * area is clickable but only the button is in the tab order (no nested
 * interactive elements). The input is reset after each pick so the same
 * file can be chosen twice (a retry after a fix).
 */

import { useId, useRef, useState, type DragEvent } from "react";
import { useContent } from "@/components/providers/locale";
import { interpolate } from "@/lib/format";
import { ALLOWED_EXTENSIONS, MAX_FILE_BYTES } from "@/lib/files/sniff";

export type DropzoneProps = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
};

const ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export function Dropzone({ onFiles, disabled = false, className = "" }: DropzoneProps) {
  const c = useContent();
  const t = c.upload.intake.dropzone;
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const describeId = useId();

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      className={`dropzone ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`.trim()}
      data-active={active ? "true" : "false"}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      onClick={(event) => {
        // Clicking the surface (not the button, which handles itself) opens the picker.
        if ((event.target as HTMLElement).closest("button")) return;
        open();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="visually-hidden"
        aria-label={t.inputLabel}
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <p className="text-[13px] font-bold tracking-[0.14em] uppercase">{active ? t.dropHere : t.title}</p>
      <p className="mt-2 text-[13px] text-text-muted">{t.hint}</p>
      <div className="mt-3">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          aria-describedby={describeId}
          onClick={open}
        >
          {t.browse}
          <span aria-hidden="true" className="btn-arrow">
            →
          </span>
        </button>
      </div>
      <p id={describeId} className="mt-4 text-[12px] text-text-faint">
        {t.formats} · {interpolate(t.maxSize, { mb: Math.round(MAX_FILE_BYTES / (1024 * 1024)) })}
      </p>
    </div>
  );
}
