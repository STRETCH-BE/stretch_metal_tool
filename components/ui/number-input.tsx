"use client";

/**
 * NumberInput — text input that accepts "1 234,56", "1,234.56" and
 * "1234.56" alike and reports the parsed number through onValueChange.
 * File path: /components/ui/number-input.tsx
 *
 * Design:
 *   - The visible control is a plain text input (inputMode="decimal") so
 *     the browser never fights the locale; the parsing rules live in
 *     lib/number-input.ts (unit-tested);
 *   - while typing, the raw text is kept; on blur it is re-formatted per
 *     the user's locale (PL "1 234,56", EN "1,234.56");
 *   - `name` goes on a hidden input carrying the canonical numeric string
 *     ("1234.56"), so a <form> posts a machine-readable value;
 *   - invalid text (letters, two decimal markers) sets aria-invalid and
 *     emits null.
 * Controlled via `value` (number | null) or uncontrolled via
 * `defaultValue`; `decimals` fixes the displayed precision.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
} from "react";
import { useLocale } from "@/components/providers/locale";
import {
  constrainNumber,
  formatNumberInput,
  isPartialNumberInput,
  parseNumberInput,
} from "@/lib/number-input";

export type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "step"
> & {
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: (value: number | null) => void;
  /** Fixed decimals when formatting on blur (and rounding the value). */
  decimals?: number;
  min?: number;
  max?: number;
  /** Marks the field invalid from the outside (server validation). */
  invalid?: boolean;
  dense?: boolean;
  /** Right-aligned tabular figures (default true — it is a number). */
  num?: boolean;
  inline?: boolean;
};

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      value,
      defaultValue,
      onValueChange,
      decimals,
      min,
      max,
      invalid,
      dense,
      num = true,
      inline,
      name,
      className = "",
      onBlur,
      ...rest
    },
    ref
  ) {
    const locale = useLocale();
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const isControlled = value !== undefined;
    const format = useCallback(
      (n: number | null | undefined) => formatNumberInput(n, locale, { decimals }),
      [locale, decimals]
    );

    const [text, setText] = useState(() => format(isControlled ? value : defaultValue));
    const [current, setCurrent] = useState<number | null>(
      isControlled ? (value ?? null) : (defaultValue ?? null)
    );
    const [textInvalid, setTextInvalid] = useState(false);
    const focused = useRef(false);

    // Controlled value changed from outside (e.g. a reset) → re-sync the text
    // unless the user is mid-edit in this very field.
    useEffect(() => {
      if (!isControlled || focused.current) return;
      setCurrent(value ?? null);
      setText(format(value));
      setTextInvalid(false);
    }, [isControlled, value, format]);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setText(raw);
      const parsed = parseNumberInput(raw);
      const partial = isPartialNumberInput(raw);
      setTextInvalid(parsed === null && raw.trim() !== "" && !partial);
      const next =
        parsed === null ? null : constrainNumber(parsed, { min, max, decimals });
      setCurrent(next);
      onValueChange?.(next);
    };

    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
      focused.current = false;
      const parsed = parseNumberInput(event.target.value);
      if (parsed === null) {
        setTextInvalid(event.target.value.trim() !== "");
        if (event.target.value.trim() === "") setText("");
      } else {
        const next = constrainNumber(parsed, { min, max, decimals });
        setCurrent(next);
        setText(format(next));
        setTextInvalid(false);
        if (next !== parsed) onValueChange?.(next);
      }
      onBlur?.(event);
    };

    const classes = `field ${dense ? "field-sm" : ""} ${num ? "field-num" : ""} ${
      inline ? "field-inline" : ""
    } ${className}`
      .replace(/\s+/g, " ")
      .trim();

    return (
      <>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={handleChange}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={handleBlur}
          aria-invalid={invalid || textInvalid ? "true" : undefined}
          className={classes}
          {...rest}
        />
        {name && (
          <input type="hidden" name={name} value={current === null ? "" : String(current)} />
        )}
      </>
    );
  }
);
