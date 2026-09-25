/**
 * Self-hosted Archivo variable font.
 * File path: /lib/fonts.ts
 *
 * One woff2 (copied from the STRETCH group site repo) covers wght 400–900
 * and wdth 100–125 with latin + latin-ext, so a single 77 KB preloaded
 * file serves body AND display type — the "expanded" industrial look is
 * the wdth axis driven to 125 in CSS (see globals.css), not a second
 * family. Exposed as --font-archivo, which both --font-display and
 * --font-body resolve to.
 */
import localFont from "next/font/local";

export const archivo = localFont({
  src: "../fonts/archivo-var.woff2",
  weight: "400 900",
  variable: "--font-archivo",
  display: "swap",
  fallback: ["system-ui", "arial"],
});
