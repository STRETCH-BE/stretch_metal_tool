/**
 * Root layout.
 * File path: /app/layout.tsx
 *
 * Wires the self-hosted Archivo variable font and the design system.
 * The <html lang> attribute follows the resolved locale (profile →
 * cookie → Accept-Language). No analytics, no consent banner — this is an
 * internal tool behind a login.
 */

import type { Metadata, Viewport } from "next";
import { archivo } from "@/lib/fonts";
import { siteConfig } from "@/lib/site-config";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { LocaleProvider } from "@/components/providers/locale";

import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.appName,
    template: `%s | ${siteConfig.appName}`,
  },
  description: "Internal quoting tool — StretchMetal",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const content = getContent(locale);
  return (
    <html lang={locale} className={archivo.variable}>
      <body className="antialiased">
        <LocaleProvider content={content}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
