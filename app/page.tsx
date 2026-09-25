/**
 * App root — sends every visitor to the quotes list (middleware already
 * guarantees a session here).
 * File path: /app/page.tsx
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/quotes");
}
