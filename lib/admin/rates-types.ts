/**
 * Contracts shared by the rate-editor server actions (lib/admin/rates-
 * actions.ts) and the client grid / CSV form (components/admin/*).
 * File path: /lib/admin/rates-types.ts
 *
 * Kept out of the "use server" file (such files may export only async
 * functions). Every error is a CODE (key of content.admin.rates.errors),
 * `message` only carries the raw database text for the "db" code.
 */

import type { LooseRow } from "@/lib/admin/db";
import type { RateTableName, RowFieldErrors } from "@/lib/admin/tables";
import type { RateErrorCode } from "@/content/admin";

export type RateRowRef = {
  /** uuid of the row (tables with an id column). */
  id?: string | null;
  /** Original natural key (materials: the code before the edit). */
  key?: string | null;
};

export type SaveRateRowInput = {
  versionId: string;
  table: RateTableName;
  ref: RateRowRef;
  values: Record<string, unknown>;
};

export type SaveRateRowResult =
  | { ok: true; row: LooseRow }
  | { ok: false; error: RateErrorCode; fieldErrors?: RowFieldErrors; message?: string };

export type DeleteRateRowInput = {
  versionId: string;
  table: RateTableName;
  ref: RateRowRef;
  /**
   * materials only: also delete the version's rate_laser rows of that
   * material (the DB foreign key cascades; the action reads them first and
   * audits every one). Without it a material that still has laser rows is
   * refused with "materialInUse" + count, so nothing disappears silently.
   */
  cascade?: boolean;
};

export type DeleteRateRowResult =
  | { ok: true; cascaded?: number }
  | { ok: false; error: RateErrorCode; message?: string; count?: number };

export type CsvImportError = {
  line: number;
  column?: string;
  code: RateErrorCode | "missingColumns";
  message?: string;
};

export type CsvImportState = {
  status: "idle" | "done" | "error";
  imported?: number;
  errors?: CsvImportError[];
  /** Form-level error code. */
  error?: RateErrorCode | "noFile" | "tooLarge" | "emptyFile" | "missingColumns";
  /** For missingColumns: the names. */
  missing?: string[];
};

export const INITIAL_CSV_IMPORT_STATE: CsvImportState = { status: "idle" };

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
