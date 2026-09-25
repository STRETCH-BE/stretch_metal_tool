/**
 * Client-safe text helpers — thin re-export kept for existing importers.
 * File path: /components/ui/format.ts
 *
 * The pure formatters live in lib/format.ts (no next/headers), which both
 * server and client code can import. Prefer "@/lib/format" in new code.
 */

export { interpolate } from "@/lib/format";
