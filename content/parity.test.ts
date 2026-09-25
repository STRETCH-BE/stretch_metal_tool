/**
 * PL ↔ EN dictionary parity — every key present in Polish must exist in
 * English with the same type, and vice versa. Guards "PL and EN both
 * complete" from the definition of done.
 * File path: /content/parity.test.ts
 */
import { describe, expect, it } from "vitest";
import { getContent } from "@/content";

function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return [`${path}:array`];
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      shape(v, path ? `${path}.${k}` : k)
    );
  }
  return [`${path}:${typeof value}`];
}

describe("content parity", () => {
  const pl = getContent("pl");
  const en = getContent("en");

  for (const domain of Object.keys(pl) as (keyof typeof pl)[]) {
    if (domain === "locale") continue;
    it(`${domain}: PL and EN expose the same keys`, () => {
      const plShape = shape(pl[domain]).sort();
      const enShape = shape(en[domain]).sort();
      expect(enShape).toEqual(plShape);
    });
  }

  it("contains no lorem ipsum or TODO copy", () => {
    const text = JSON.stringify([pl, en]).toLowerCase();
    expect(text).not.toMatch(/lorem ipsum/);
    expect(text).not.toMatch(/\btodo\b/);
  });
});
