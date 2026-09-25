/**
 * Customer form contract — zod schema, option lists and the action state
 * shared by the server actions (lib/customers/actions.ts) and the client
 * form (components/customers/customer-form.tsx).
 * File path: /lib/customers/schema.ts
 *
 * Kept out of the "use server" file because such files may export only
 * async functions. Validation messages are CODES (keys of
 * quote.customers.errors), never copy — the form maps them per locale.
 */

import { z } from "zod";
import type { CustomerRow, UserLocale } from "@/lib/db/types";
import type {
  CustomerClassCode,
  CustomerCountryCode,
} from "@/content/quote";

export const COUNTRY_CODES = [
  "PL",
  "DE",
  "NL",
  "BE",
  "CZ",
  "SK",
  "AT",
  "FR",
  "IT",
  "ES",
  "GB",
  "DK",
  "SE",
  "FI",
  "NO",
  "CH",
  "LT",
  "LV",
  "EE",
  "HU",
  "RO",
  "UA",
  "LU",
  "IE",
  "PT",
  "SI",
  "HR",
] as const satisfies readonly CustomerCountryCode[];

export const CUSTOMER_CLASSES = [
  "standard",
  "key",
  "new",
  "distributor",
] as const satisfies readonly CustomerClassCode[];

export const DEFAULT_COUNTRY: CustomerCountryCode = "PL";
export const DEFAULT_CUSTOMER_CLASS: CustomerClassCode = "standard";

export type CustomerErrorCode =
  | "required"
  | "tooLong"
  | "invalidEmail"
  | "invalidCountry"
  | "invalidClass"
  | "invalidLocale"
  | "notFound"
  | "forbidden"
  | "generic";

/** Trimmed optional text → null when empty. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((v) => (v === "" ? null : v));
}

export const customerSchema = z.object({
  name: z.string().trim().min(1, "required").max(200, "tooLong"),
  vat_id: optionalText(32),
  country: z.enum(COUNTRY_CODES, "invalidCountry"),
  address: optionalText(500),
  email: z
    .string()
    .trim()
    .max(200, "tooLong")
    .refine((v) => v === "" || z.email().safeParse(v).success, "invalidEmail")
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  phone: optionalText(40),
  customer_class: z.enum(CUSTOMER_CLASSES, "invalidClass"),
  preferred_locale: z
    .enum(["", "pl", "en"], "invalidLocale")
    .transform((v): UserLocale | null => (v === "" ? null : v)),
  notes: optionalText(2000),
});

export type CustomerInput = z.output<typeof customerSchema>;
export type CustomerField = keyof z.input<typeof customerSchema>;
export type CustomerFieldErrors = Partial<Record<CustomerField, CustomerErrorCode>>;

export type CustomerFormState = {
  status: "idle" | "error" | "saved";
  /** Per-field error codes (keys of quote.customers.errors). */
  fieldErrors?: CustomerFieldErrors;
  /** Form-level error code. */
  error?: CustomerErrorCode;
  /** Row after a successful save (edit form re-syncs its fields). */
  customer?: CustomerRow;
};

export const INITIAL_CUSTOMER_FORM_STATE: CustomerFormState = { status: "idle" };

function fieldString(formData: FormData, name: CustomerField): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** FormData → validated input or per-field error codes. */
export function parseCustomerForm(
  formData: FormData
): { ok: true; data: CustomerInput } | { ok: false; fieldErrors: CustomerFieldErrors } {
  const raw: Record<CustomerField, string> = {
    name: fieldString(formData, "name"),
    vat_id: fieldString(formData, "vat_id"),
    country: fieldString(formData, "country").toUpperCase(),
    address: fieldString(formData, "address"),
    email: fieldString(formData, "email"),
    phone: fieldString(formData, "phone"),
    customer_class: fieldString(formData, "customer_class"),
    preferred_locale: fieldString(formData, "preferred_locale"),
    notes: fieldString(formData, "notes"),
  };
  const result = customerSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const fieldErrors: CustomerFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || field in fieldErrors) continue;
    fieldErrors[field as CustomerField] = toErrorCode(issue.message);
  }
  return { ok: false, fieldErrors };
}

const KNOWN_CODES: readonly CustomerErrorCode[] = [
  "required",
  "tooLong",
  "invalidEmail",
  "invalidCountry",
  "invalidClass",
  "invalidLocale",
];

function toErrorCode(message: string): CustomerErrorCode {
  return (KNOWN_CODES as readonly string[]).includes(message)
    ? (message as CustomerErrorCode)
    : "generic";
}
