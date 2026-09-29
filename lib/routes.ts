/**
 * Route map — single source of truth for every internal path.
 * File path: /lib/routes.ts
 *
 * The app has one locale-independent route tree (language is a user
 * preference, not a URL segment). Pages under app/(app)/ render inside
 * the authenticated shell; the rest are public.
 */

export const routes = {
  home: "/",
  login: "/login",
  forbidden: "/forbidden",
  authCallback: "/auth/callback",
  guide: "/guide",
  guideExampleDxf: "/downloads/stretchmetal-example.dxf",

  quotes: "/quotes",
  quoteNew: "/quotes/new",
  quote: (id: string) => `/quotes/${id}`,
  quotePdf: (id: string, locale?: "pl" | "en") =>
    `/api/quotes/${id}/pdf${locale ? `?locale=${locale}` : ""}`,
  /** PDF export with the per-part operation summary toggle (?ops=1). */
  /** `parts=1` adds the "parts of assembly" appendix (assembly members are never rows of the main table). */
  quotePdfExport: (id: string, locale: "pl" | "en", ops: boolean, parts = false) =>
    `/api/quotes/${id}/pdf?locale=${locale}${ops ? "&ops=1" : ""}${parts ? "&parts=1" : ""}`,
  quoteUpload: (id: string) => `/quotes/${id}/upload`,

  upload: "/upload",
  part: (id: string) => `/parts/${id}`,
  partExportDxf: (id: string) => `/api/parts/${id}/export-dxf`,

  customers: "/customers",
  customerNew: "/customers/new",
  customer: (id: string) => `/customers/${id}`,

  admin: "/admin",
  adminRates: "/admin/rates",
  adminRateVersion: (id: string) => `/admin/rates/${id}`,
  adminRateTable: (id: string, table: string) => `/admin/rates/${id}/${table}`,
  adminRateVersionDiff: (id: string) => `/admin/rates/${id}/diff`,
  adminBendTable: "/admin/bend-table",
  adminBendTableVersion: (id: string) => `/admin/bend-table/${id}`,
  adminTooling: "/admin/tooling",
  adminHardware: "/admin/hardware",
  adminMachines: "/admin/machines",
  adminMachine: (code: string) => `/admin/machines/${encodeURIComponent(code)}`,
  adminCalculator: "/admin/calculator",
  adminUsers: "/admin/users",
  adminOverrides: "/admin/overrides",
  adminAudit: "/admin/audit",
  /** Assembly-mode settings tables (company data, VAT, packaging, shipping, setups, assembly labour, weld speeds). */
  adminSettings: "/admin/settings",
  /** One settings table by its URL slug (lib/admin/settings-types.ts SETTINGS_TABLE_SLUGS). */
  adminSettingsTable: (table: string) => `/admin/settings/${encodeURIComponent(table)}`,

  api: {
    health: "/api/health",
    filesSign: "/api/files/sign",
    filesComplete: "/api/files/complete",
    fileUrl: (id: string) => `/api/files/${id}/url`,
    fileStatus: (id: string) => `/api/files/${id}/status`,
    fileResumeIntake: (id: string) => `/api/files/${id}/resume-intake`,
    geometry: "/api/geometry",
    aiPrefill: "/api/ai/prefill",
    quotePrice: (id: string) => `/api/quotes/${id}/price`,
    quoteSend: (id: string) => `/api/quotes/${id}/send`,
    adminRateCsv: (id: string, table: string) => `/api/admin/rates/${id}/${table}/csv`,
  },
} as const;
