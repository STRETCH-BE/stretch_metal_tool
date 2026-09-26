/**
 * The dependency-free .xlsx reader used by scripts/seed-market-rates.mjs:
 * round-trips a workbook written by the test writer (stored zip, inline
 * strings), reads shared strings and deflated entries from a hand-built
 * archive, and maps the header row to records.
 * File path: /test/rates/xlsx.test.ts
 */

import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { columnIndex, gridToRecords, parseCellRef, readWorkbook, readZipEntries, unescapeXml } from "../../scripts/lib/xlsx.mjs";
import { writeWorkbook } from "../../scripts/lib/xlsx-write.mjs";

describe("xlsx reader", () => {
  it("round-trips sheets, headers, numbers, strings and booleans", () => {
    const buffer = writeWorkbook({
      settings: [
        ["key", "value"],
        ["rate_version_name", "market-247+10% v1 (26 Sep 2026)"],
        ["markup", 1.1],
      ],
      rate_leadtime: [
        ["working_days", "multiplier", "note"],
        [3, 1.4, null],
        [6, 1.15, "rush"],
        [11, 1, null],
        [null, null, null],
      ],
      flags: [["a", "b"], [true, false]],
    });
    const { sheets } = readWorkbook(buffer);
    expect([...sheets.keys()]).toEqual(["settings", "rate_leadtime", "flags"]);
    const settings = sheets.get("settings")!;
    expect(settings.headers).toEqual(["key", "value"]);
    expect(settings.records.map((r: { values: unknown }) => r.values)).toEqual([
      { key: "rate_version_name", value: "market-247+10% v1 (26 Sep 2026)" },
      { key: "markup", value: 1.1 },
    ]);
    const lead = sheets.get("rate_leadtime")!;
    expect(lead.records).toHaveLength(3);
    expect(lead.records[1].values).toEqual({ working_days: 6, multiplier: 1.15, note: "rush" });
    expect(lead.records[1].row).toBe(3);
    expect(sheets.get("flags")!.records[0].values).toEqual({ a: true, b: false });
  });

  it("reads deflated entries and shared strings (the format Excel writes)", () => {
    const parts: [string, string][] = [
      ["xl/workbook.xml", `<workbook xmlns:r="x"><sheets><sheet name="Sheet 1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Type="t" Target="/xl/worksheets/sheet1.xml"/></Relationships>`],
      ["xl/sharedStrings.xml", `<sst><si><t>code</t></si><si><r><t>price_</t></r><r><t>sell</t></r></si><si><t>DC01 &amp; S235</t></si></sst>`],
      [
        "xl/worksheets/sheet1.xml",
        `<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"><f>1+1</f><v>2.5</v></c><c r="C3" t="e"><v>#N/A</v></c></row></sheetData></worksheet>`,
      ],
    ];
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, xml] of parts) {
      const data = deflateRawSync(Buffer.from(xml));
      const nameBuf = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(xml.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt32LE(data.length, 20);
      cd.writeUInt32LE(xml.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(offset, 42);
      chunks.push(local, nameBuf, data);
      central.push(cd, nameBuf);
      offset += local.length + nameBuf.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(parts.length, 8);
    eocd.writeUInt16LE(parts.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    const archive = Buffer.concat([...chunks, cdBuf, eocd]);

    expect([...readZipEntries(archive).keys()]).toEqual(parts.map((p) => p[0]));
    const { sheets } = readWorkbook(archive);
    const sheet = sheets.get("Sheet 1")!;
    expect(sheet.headers).toEqual(["code", "price_sell"]);
    expect(sheet.records[0].values).toEqual({ code: "DC01 & S235", price_sell: 2.5 });
  });

  it("helpers: cell refs, column letters, entities, header detection", () => {
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("Z")).toBe(25);
    expect(columnIndex("AA")).toBe(26);
    expect(parseCellRef("C12")).toEqual({ col: 2, row: 12 });
    expect(unescapeXml("a &lt; b &amp; &#39;c&#x27;")).toBe("a < b & 'c'");
    const grid = new Map<number, Map<number, unknown>>([
      [1, new Map<number, unknown>([[0, 42]])],
      [2, new Map<number, unknown>([[0, " name "], [2, "qty"]])],
      [3, new Map<number, unknown>([[0, "x"], [1, "ignored"], [2, 3]])],
      [4, new Map<number, unknown>([[0, ""], [2, null]])],
    ]);
    const { headers, records } = gridToRecords(grid);
    expect(headers).toEqual(["name", "qty"]);
    expect(records).toEqual([{ row: 3, values: { name: "x", qty: 3 } }]);
  });
});
