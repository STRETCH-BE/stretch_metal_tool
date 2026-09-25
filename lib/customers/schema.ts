/**
 * Customer form contract — zod schema, option lists and the action state
 * shared by the server actions (lib/customers/actions.ts) and the client
 * form (components/customers/customer-form.tsx).
 * File path: /lib/customers/schema.ts
 *
 * Kept out of the "use server" file because such files may export only
 * async functions. Validation messages are CODES (keys of
 * quote.customers.errors), never copy — the form maps them per locale.
 *
 * Country: ANY ISO 3166-1 alpha-2 code is valid (lib/customers/countries.ts)
 * because the only business rule is PL → PLN, everything else → EUR.
 * PREFERRED_COUNTRY_CODES is just the curated top of the <select>, with
 * hand-written names in content — it is not the validation set.
 *
 * `values`: React 19 resets a <form action> after the action settles, so
 * every failed submit echoes the raw submitted strings back in the state
 * and the form uses them as defaultValue (nothing typed is lost).
 */

import { z } from "zod";
import type { CustomerRow, UserLocale } from "@/lib/db/types";
import type {
  CustomerClassCode,
  CustomerCountryCode,
} from "@/content/quote";
import { isCountryCode, normalizeCountryCode } from "@/lib/customers/countries";

/** Curated countries shown first in the select (names in content.quote.customers.countries). */
export const PREFERRED_COUNTRY_CODES = [
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
  country: z
    .string()
    .transform(normalizeCountryCode)
    .refine(isCountryCode, "invalidCountry"),
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
/** Raw submitted strings, one per field (what the user typed). */
export type CustomerFormValues = Record<CustomerField, string>;

export const CUSTOMER_FIELDS: readonly CustomerField[] = [
  "name",
  "vat_id",
  "country",
  "address",
  "email",
  "phone",
  "customer_class",
  "preferred_locale",
  "notes",
];

export type CustomerFormState = {
  status: "idle" | "error" | "saved";
  /** Per-field error codes (keys of quote.customers.errors). */
  fieldErrors?: CustomerFieldErrors;
  /** Form-level error code. */
  error?: CustomerErrorCode;
  /**
   * Submitted values echoed back on ANY error so the form can re-populate
   * after React 19's automatic form reset (see file header).
   */
  values?: CustomerFormValues;
  /** Row after a successful save (edit form re-syncs its fields). */
  customer?: CustomerRow;
};

export const INITIAL_CUSTOMER_FORM_STATE: CustomerFormState = { status: "idle" };

function fieldString(formData: FormData, name: CustomerField): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** FormData → raw strings for every customer field (missing → ""). */
export function readCustomerFormValues(formData: FormData): CustomerFormValues {
  const values = {} as CustomerFormValues;
  for (const field of CUSTOMER_FIELDS) values[field] = fieldString(formData, field);
  return values;
}

/** FormData → validated input, or per-field error codes + the raw values. */
export function parseCustomerForm(
  formData: FormData
):
  | { ok: true; data: CustomerInput; values: CustomerFormValues }
  | { ok: false; fieldErrors: CustomerFieldErrors; values: CustomerFormValues } {
  const values = readCustomerFormValues(formData);
  const result = customerSchema.safeParse(values);
  if (result.success) return { ok: true, data: result.data, values };

  const fieldErrors: CustomerFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || field in fieldErrors) continue;
    fieldErrors[field as CustomerField] = toErrorCode(issue.message);
  }
  return { ok: false, fieldErrors, values };
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
