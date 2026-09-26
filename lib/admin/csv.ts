/**
 * Tiny RFC 4180 CSV parser + writer for the rate-table import/export.
 * File path: /lib/admin/csv.ts
 *
 * Pure, dependency-free. Parsing rules: fields separated by commas
 * (`delimiter` option: ";" for spreadsheets saved in a Polish locale),
 * records by CRLF or LF, a field may be wrapped in double quotes and then
 * contains commas, line breaks and doubled quotes (`""` → `"`). A leading
 * UTF-8 BOM is dropped, a trailing line break does not produce an empty
 * record, blank lines are skipped. Writing quotes every field that needs
 * it and always uses CRLF (what Excel expects).
 *
 * `parseCsvRecords` maps the header row onto objects; header names are
 * trimmed and lower-cased so "Price_Per_M " matches "price_per_m". Each
 * record carries the PHYSICAL line it starts on (blank lines and line
 * breaks inside quotes are counted) so import errors point at the file.
 */

export type CsvParseOptions = {
  /** Field delimiter (default ","). */
  delimiter?: string;
};

export type CsvRow = { cells: string[]; /** Physical 1-based line the record starts on. */ line: number };

/** Parse CSV text into records with their physical start line (blank lines skipped, but counted). */
export function parseCsvRows(text: string, options: CsvParseOptions = {}): CsvRow[] {
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new Error(`parseCsv: unsupported delimiter ${JSON.stringify(delimiter)}`);
  }
  let input = text;
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);

  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let lineNo = 1;
  let recordLine = 1;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push({ cells: row, line: recordLine });
    row = [];
    recordLine = lineNo;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") lineNo++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === "\r") {
      if (input[i + 1] === "\n") i++;
      lineNo++;
      endRow();
      continue;
    }
    if (ch === "\n") {
      lineNo++;
      endRow();
      continue;
    }
    field += ch;
    fieldStarted = true;
  }
  if (quoted) throw new Error("parseCsv: unterminated quoted field");
  if (field !== "" || row.length > 0 || fieldStarted) endRow();
  return rows;
}

/** Parse CSV text into rows of string cells (no header handling). */
export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  return parseCsvRows(text, options).map((row) => row.cells);
}

export type CsvRecord = { line: number; values: Record<string, string> };

export type CsvRecords = {
  header: string[];
  records: CsvRecord[];
};

/** Parse with the first row as header → objects keyed by normalised header. */
export function parseCsvRecords(text: string, options: CsvParseOptions = {}): CsvRecords {
  const rows = parseCsvRows(text, options);
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  const records: CsvRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const { cells, line } = rows[i];
    if (cells.every((cell) => cell.trim() === "")) continue;
    const values: Record<string, string> = {};
    header.forEach((name, index) => {
      if (name === "") return;
      values[name] = cells[index] ?? "";
    });
    records.push({ line, values });
  }
  return { header, records };
}

/** Guess the delimiter from the header line (";" wins when it has more separators). */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialise a header + rows to CSV (comma, CRLF, UTF-8 without BOM). */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
