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
  guide: "/guide",
  guideExampleDxf: "/downloads/stretchmetal-example.dxf",

  quotes: "/quotes",
  quoteNew: "/quotes/new",
  quote: (id: string) => `/quotes/${id}`,
  quotePdf: (id: string, locale?: "pl" | "en") =>
    `/api/quotes/${id}/pdf${locale ? `?locale=${locale}` : ""}`,
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
  adminMachines: "/admin/machines",
  adminCalculator: "/admin/calculator",
  adminUsers: "/admin/users",
  adminOverrides: "/admin/overrides",
  adminAudit: "/admin/audit",

  api: {
    health: "/api/health",
    filesSign: "/api/files/sign",
    filesComplete: "/api/files/complete",
    fileUrl: (id: string) => `/api/files/${id}/url`,
    geometry: "/api/geometry",
    aiPrefill: "/api/ai/prefill",
    quotePrice: (id: string) => `/api/quotes/${id}/price`,
    quoteSend: (id: string) => `/api/quotes/${id}/send`,
  },
} as const;
