/**
 * AppShell — the authenticated frame: skip link, black Sidebar, Topbar and
 * the surface-toned main column (.app-shell / .app-main from globals.css).
 * File path: /components/shell/app-shell.tsx
 *
 * Server component. The layout renders <main id="main" className="app-content">
 * as the children so the skip link target and landmark live with the page
 * tree. At < 1024 px the grid collapses to one column and the sidebar
 * turns into a top bar with a menu button (see Sidebar).
 */

import type { ReactNode } from "react";
import type { Session } from "@/lib/auth";
import type { Content } from "@/content";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export type AppShellProps = {
  session: Session;
  content: Content;
  children: ReactNode;
  /** Optional topbar page slot (breadcrumbs/title). */
  topbarSlot?: ReactNode;
};

export function AppShell({ session, content, children, topbarSlot }: AppShellProps) {
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        {content.common.app.skipToContent}
      </a>
      <Sidebar role={session.profile.role} />
      <div className="app-main flex min-h-dvh flex-col">
        <Topbar session={session} content={content} slot={topbarSlot} />
        {children}
      </div>
    </div>
  );
}
