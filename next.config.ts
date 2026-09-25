import type { NextConfig } from "next";

/**
 * Next.js configuration.
 * File path: /next.config.ts
 *
 * - `serverExternalPackages`: pdfjs-dist and @react-pdf/renderer ship
 *   Node-only builds that must not be bundled by webpack/turbopack for the
 *   route handlers that use them (PDF text extraction, quote PDF).
 * - No image optimisation config: the app renders SVG thumbnails inline
 *   from geometry JSON and has no photography.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfjs-dist", "@react-pdf/renderer"],
  experimental: {
    serverActions: {
      // Server actions carry only JSON (ids, annotations, rate rows) — files
      // go straight from the browser to Supabase Storage via signed URLs.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
