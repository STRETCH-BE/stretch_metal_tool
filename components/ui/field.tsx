/**
 * Form field primitives — Field (label + help + error wrapper) and the
 * forwardRef controls Input / Select / Textarea styled with .field.
 * File path: /components/ui/field.tsx
 *
 * Server-safe (no hooks). Conventions:
 *   - `invalid` sets aria-invalid so .field[aria-invalid="true"] turns red;
 *   - Field renders help as `${htmlFor}-help` and the error as
 *     `${htmlFor}-error` (role="alert"); pass `describedBy(htmlFor, ...)`
 *     to the control's aria-describedby to wire them;
 *   - `dense` switches to .field-sm (tables, toolbars), `num` to .field-num
 *     (right-aligned tabular figures).
 * NumberInput lives in number-input.tsx (needs state + locale).
 */

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export type FieldProps = {
  label: ReactNode;
  htmlFor: string;
  error?: string | null;
  help?: ReactNode;
  children: ReactNode;
  /** Adds the "required" marker text (from content) after the label. */
  requiredLabel?: string;
  /** Dark surfaces (login) need the muted-on-dark label colour. */
  tone?: "light" | "dark";
  className?: string;
};

/** aria-describedby value for a control inside <Field htmlFor={id}>. */
export function describedBy(
  id: string,
  options: { help?: boolean; error?: boolean }
): string | undefined {
  const ids: string[] = [];
  if (options.error) ids.push(`${id}-error`);
  if (options.help) ids.push(`${id}-help`);
  return ids.length ? ids.join(" ") : undefined;
}

export function Field({
  label,
  htmlFor,
  error,
  help,
  children,
  requiredLabel,
  tone = "light",
  className = "",
}: FieldProps) {
  const dark = tone === "dark";
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="field-label"
        style={dark ? { color: "var(--color-on-dark-muted)" } : undefined}
      >
        {label}
        {requiredLabel && (
          <span className="ml-2 normal-case tracking-normal text-red">
            {requiredLabel}
          </span>
        )}
      </label>
      {children}
      {help && (
        <p
          id={`${htmlFor}-help`}
          className="field-help"
          style={dark ? { color: "var(--color-on-dark-muted)" } : undefined}
        >
          {help}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type ControlFlags = {
  invalid?: boolean;
  dense?: boolean;
  /** Right-aligned tabular figures. */
  num?: boolean;
  /** Width auto instead of 100 %. */
  inline?: boolean;
};

function controlClass(
  { dense, num, inline }: Omit<ControlFlags, "invalid">,
  className = ""
): string {
  return `field ${dense ? "field-sm" : ""} ${num ? "field-num" : ""} ${
    inline ? "field-inline" : ""
  } ${className}`
    .replace(/\s+/g, " ")
    .trim();
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & ControlFlags;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, dense, num, inline, className, type = "text", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid ? "true" : undefined}
      className={controlClass({ dense, num, inline }, className)}
      {...rest}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & ControlFlags;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, dense, num, inline, className, children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid ? "true" : undefined}
      className={controlClass({ dense, num, inline }, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  ControlFlags;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, dense, num, inline, className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid ? "true" : undefined}
        className={controlClass({ dense, num, inline }, className)}
        {...rest}
      />
    );
  }
);
