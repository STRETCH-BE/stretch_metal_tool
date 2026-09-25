/**
 * Login page — STUB replaced by the auth build step (email + password,
 * optional magic link). Public route (middleware PUBLIC_PATHS).
 * File path: /app/login/page.tsx
 */

import { getPublicLocale } from "@/lib/i18n";
import { getContent } from "@/content";

export default async function LoginPage() {
  const c = getContent(await getPublicLocale());
  return (
    <main id="main" className="section-dark min-h-dvh">
      <div className="container-sm section">
        <h1 className="h2-sm">{c.common.login.title}</h1>
        <p className="lead mt-4">{c.common.login.lead}</p>
      </div>
    </main>
  );
}
