/**
 * Authenticated app layout — every page under app/(app)/ renders inside
 * the shell (sidebar + topbar) and requires a session.
 * File path: /app/(app)/layout.tsx
 *
 * Server component: requireUser() redirects to /login when signed out
 * (the middleware already does, this is the second line of defence and
 * what gives the shell the profile/role). Content is resolved once per
 * request (profile locale → cookie → Accept-Language) and passed to the
 * server-side shell; client components read it from LocaleProvider.
 */

import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();
  const content = getContent(await getLocale());
  return (
    <ToastProvider>
      <AppShell session={session} content={content}>
        <main id="main" className="app-content flex-1">
          {children}
        </main>
      </AppShell>
    </ToastProvider>
  );
}
