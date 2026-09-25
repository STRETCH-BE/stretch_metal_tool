/**
 * Topbar — white 56 px bar: page slot (breadcrumbs by default), locale
 * switcher, signed-in user + role chip, sign-out.
 * File path: /components/shell/topbar.tsx
 *
 * Server component: it receives the session and the resolved content
 * dictionary from the layout, and posts the signOut server action from a
 * plain <form> so it works without JavaScript.
 */

import type { ReactNode } from "react";
import type { Session } from "@/lib/auth";
import type { Content } from "@/content";
import { signOut } from "@/lib/actions/auth";
import { StatusChip } from "@/components/ui/status-chip";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";

export type TopbarProps = {
  session: Session;
  content: Content;
  /** Page-provided breadcrumbs/title; defaults to <Breadcrumbs />. */
  slot?: ReactNode;
};

export function Topbar({ session, content, slot }: TopbarProps) {
  const c = content.common;
  const name = session.profile.full_name?.trim() || session.profile.email;
  return (
    <header className="app-topbar">
      <div className="min-w-0 flex-1">{slot ?? <Breadcrumbs />}</div>

      <LocaleSwitcher />

      <div role="group" className="hidden items-center gap-2 md:flex" aria-label={c.shell.userMenu}>
        <span className="visually-hidden">{c.shell.signedInAs}</span>
        <span className="max-w-[220px] truncate text-[13px] font-semibold" title={session.profile.email}>
          {name}
        </span>
        <StatusChip severity="neutral" label={c.roles[session.profile.role]} plain />
      </div>

      <form action={signOut}>
        <button type="submit" className="btn btn-ghost btn-sm">
          {c.nav.signOut}
        </button>
      </form>
    </header>
  );
}
