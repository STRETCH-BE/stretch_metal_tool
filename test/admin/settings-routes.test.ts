/**
 * Settings route map and the pure settings-types helpers: every settings
 * table has a slug that round-trips through routes.adminSettingsTable and
 * settingsTableFromSlug, unknown slugs resolve to null, and the company
 * placeholder detector finds the design-doc markers.
 * File path: /test/admin/settings-routes.test.ts
 */
import { describe, expect, it } from "vitest";
import { routes } from "@/lib/routes";
import {
  companySettingsPlaceholderFields,
  isJobSetupCode,
  isSettingsTable,
  SETTINGS_DB_TABLES,
  SETTINGS_TABLE_SLUGS,
  SETTINGS_TABLES,
  settingsTableFromSlug,
} from "@/lib/admin/settings-types";

describe("settings routes", () => {
  it("exposes the index and one page per table", () => {
    expect(routes.adminSettings).toBe("/admin/settings");
    expect(routes.adminSettingsTable("weld-speeds")).toBe("/admin/settings/weld-speeds");
    for (const table of SETTINGS_TABLES) {
      const slug = SETTINGS_TABLE_SLUGS[table];
      expect(routes.adminSettingsTable(slug)).toBe(`/admin/settings/${slug}`);
      expect(settingsTableFromSlug(slug)).toBe(table);
    }
  });

  it("uses kebab-case slugs that match the page folders and maps every table to its DB name", () => {
    expect(Object.values(SETTINGS_TABLE_SLUGS).sort()).toEqual(["assembly", "company", "packaging", "setups", "shipping", "vat", "weld-speeds"]);
    expect(SETTINGS_DB_TABLES.weldSpeeds).toBe("weld_speeds");
    expect(SETTINGS_DB_TABLES.setups).toBe("job_setup_rates");
    expect(settingsTableFromSlug("weldSpeeds")).toBeNull();
    expect(settingsTableFromSlug("nope")).toBeNull();
    expect(isSettingsTable("vat")).toBe(true);
    expect(isSettingsTable("weld-speeds")).toBe(false);
    expect(isJobSetupCode("weld_fitup")).toBe(true);
    expect(isJobSetupCode("paint")).toBe(false);
  });
});

describe("companySettingsPlaceholderFields", () => {
  it("lists the fields that still carry a placeholder marker", () => {
    expect(
      companySettingsPlaceholderFields({ brand: "STRETCHMETAL", nip: "PL0000000000", phone: "+48 000-000-000", iban_eur: "PL00 XXXX", legal_name: "[CONFIRM] Sp. z o.o.", city: "Częstochowa" })
    ).toEqual(["legal_name", "phone", "nip", "iban_eur"]);
    expect(companySettingsPlaceholderFields({ brand: "STRETCHMETAL", nip: "PL5732911703", iban_pln: "PL05 1050 1142 1000 0090 3188 9240" })).toEqual([]);
  });
});
