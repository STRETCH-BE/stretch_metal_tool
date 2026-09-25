/**
 * Number-input parsing and formatting helpers — pure, React-free, so the
 * NumberInput primitive's behaviour is unit-testable.
 * File path: /lib/number-input.ts
 *
 * Users type numbers the Polish way ("1 234,56"), the English way
 * ("1,234.56") or the programmer's way ("1234.56"). Rules:
 *   - every kind of space (regular, NBSP, narrow NBSP, thin), apostrophe
 *     and underscore is a grouping character and is dropped;
 *   - when both "," and "." occur, the LAST one is the decimal separator
 *     and the other is grouping ("1.234,56" and "1,234.56" both parse);
 *   - a single "," or "." is the decimal separator ("1,5" = "1.5");
 *   - several "," or several "." are grouping ("1,234,567" = 1234567);
 *   - anything else (letters, two decimal markers) → null, never NaN.
 * Formatting goes through Intl so PL output is "1 234,56" (NBSP), EN is
 * "1,234.56" — both round-trip through parseNumberInput.
 */

import type { Locale } from "@/lib/site-config";

const GROUPING_CHARS = /[\s   '_]/g;
const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;
const INTL_TAG: Record<Locale, string> = { pl: "pl-PL", en: "en-GB" };

/** Removes a grouping separator when it delimits proper 3-digit groups; null otherwise. */
function stripGrouping(integerPart: string, sep: "," | "."): string | null {
  const escaped = sep === "." ? "\\." : ",";
  const grouped = new RegExp(`^[-+]?\\d{1,3}(${escaped}\\d{3})+$`);
  if (!grouped.test(integerPart)) return null;
  return integerPart.split(sep).join("");
}

/** Parses free-form user input into a number; null for empty or invalid. */
export function parseNumberInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let text = raw.replace(GROUPING_CHARS, "").trim();
  if (text === "") return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const commas = text.split(",").length - 1;
  const dots = text.split(".").length - 1;

  if (commas > 0 && dots > 0) {
    // Both present: the later one is the decimal separator, the other groups.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const groupSep = decimalSep === "," ? "." : ",";
    const decimalIndex = decimalSep === "," ? lastComma : lastDot;
    const integerPart = text.slice(0, decimalIndex);
    const fraction = text.slice(decimalIndex + 1);
    if (fraction.includes(",") || fraction.includes(".")) return null;
    const integer = stripGrouping(integerPart, groupSep);
    if (integer === null) return null;
    text = `${integer}.${fraction}`;
  } else if (commas > 1) {
    const integer = stripGrouping(text, ",");
    if (integer === null) return null;
    text = integer;
  } else if (commas === 1) {
    text = text.replace(",", ".");
  } else if (dots > 1) {
    const integer = stripGrouping(text, ".");
    if (integer === null) return null;
    text = integer;
  }

  if (!NUMERIC.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export type FormatNumberInputOptions = {
  /** Fixed number of decimals; omit to keep up to `maxDecimals`. */
  decimals?: number;
  /** Upper bound on decimals when `decimals` is not fixed (default 4). */
  maxDecimals?: number;
  /** Thousands grouping (default true). */
  grouping?: boolean;
};

/** Formats a number for display in the input, per locale. Empty for null. */
export function formatNumberInput(
  value: number | null | undefined,
  locale: Locale,
  options: FormatNumberInputOptions = {}
): string {
  if (value == null || !Number.isFinite(value)) return "";
  const { decimals, maxDecimals = 4, grouping = true } = options;
  return new Intl.NumberFormat(INTL_TAG[locale], {
    useGrouping: grouping,
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? maxDecimals,
  }).format(value);
}

/**
 * True while the text could still become a valid number as the user types
 * ("1,", "-", "1 2"). Used to decide whether to mark the field invalid
 * mid-keystroke; final validity is parseNumberInput() !== null.
 */
export function isPartialNumberInput(raw: string): boolean {
  const text = raw.replace(GROUPING_CHARS, "");
  return /^[-+]?[\d.,]*$/.test(text);
}

/** Clamps + rounds a parsed value to the step/min/max the field declares. */
export function constrainNumber(
  value: number,
  constraints: { min?: number; max?: number; decimals?: number }
): number {
  let result = value;
  if (constraints.decimals != null) {
    const factor = 10 ** constraints.decimals;
    result = Math.round(result * factor) / factor;
  }
  if (constraints.min != null) result = Math.max(constraints.min, result);
  if (constraints.max != null) result = Math.min(constraints.max, result);
  return result;
}
