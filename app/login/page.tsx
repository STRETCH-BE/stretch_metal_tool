/**
 * Login page — dark hero-style sign-in: e-mail + password, secondary
 * magic-link button. Public route (middleware PUBLIC_PATHS).
 * File path: /app/login/page.tsx
 *
 * Server component; both buttons post server actions from
 * lib/actions/auth.ts. State comes back through the query string:
 *   ?error=invalid|config|magic|validation|callback   → message
 *   ?sent=1                                          → magic link sent
 *   ?next=/path                                      → return target
 * When Supabase is not configured (env.hasSupabase() false) the page
 * still renders, explains it, and disables both buttons so the build and
 * a bare local checkout work.
 */

import type { Metadata } from "next";
import { getPublicLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { env } from "@/lib/env";
import { routes } from "@/lib/routes";
import { signInWithPassword, sendMagicLink } from "@/lib/actions/auth";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Logo } from "@/components/ui/logo";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getPublicLocale());
  return { title: c.common.login.title };
}

type SearchParams = Promise<{
  error?: string | string[];
  sent?: string | string[];
  next?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "";
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const c = getContent(await getPublicLocale());
  const t = c.common.login;
  const configured = env.hasSupabase();
  const error = first(params.error);
  const sent = first(params.sent) === "1";
  const next = safeNext(first(params.next));

  const errorMessage: Record<string, string> = {
    invalid: t.invalid,
    validation: c.common.errors.validation,
    config: c.common.errors.supabaseNotConfigured,
    magic: t.magicLinkFailed,
    callback: t.callbackFailed,
  };
  const message = error ? (errorMessage[error] ?? c.common.errors.generic) : null;

  return (
    <main id="main" className="section-dark flex min-h-dvh flex-col">
      <header
        className="flex items-center justify-between border-b border-line-dark px-6"
        style={{ height: "var(--header-h)" }}
      >
        <Logo ariaLabel={c.common.app.logoAria} suffix="QUOTE" href={routes.login} size={22} />
        <LocaleSwitcher tone="dark" />
      </header>

      <div className="container-sm section grid flex-1 items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <Eyebrow number="01">{t.eyebrow}</Eyebrow>
          <h1 className="h2 break-words">{t.title}</h1>
          <p className="lead mt-8 max-w-lg">{t.lead}</p>
          <p className="mt-6 max-w-lg text-[13.5px] text-on-dark-muted">{t.help}</p>
        </div>

        <div className="panel-dark p-8 md:p-10">
          <div className="flex flex-col gap-4" aria-live="polite">
            {!configured && (
              <Notice tone="error">
                {c.common.errors.supabaseNotConfigured} {t.notConfigured}
              </Notice>
            )}
            {message && <Notice tone="error">{message}</Notice>}
            {sent && <Notice tone="success">{t.magicLinkSent}</Notice>}
          </div>

          <form action={signInWithPassword} className="mt-6 flex flex-col gap-5">
            {next && <input type="hidden" name="next" value={next} />}
            <Field label={t.email} htmlFor="login-email" tone="dark">
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder={t.emailPlaceholder}
                disabled={!configured}
                invalid={error === "invalid" || error === "validation"}
              />
            </Field>
            <Field label={t.password} htmlFor="login-password" tone="dark">
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder={t.passwordPlaceholder}
                disabled={!configured}
                invalid={error === "invalid"}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton arrow disabled={!configured} pendingLabel={c.common.actions.loading}>
                {t.submit}
              </SubmitButton>
            </div>

            <div className="divider-dark my-2" />

            <p className="text-[13px] text-on-dark-muted">{t.magicLinkHelp}</p>
            <div>
              <SubmitButton
                variant="ghost-light"
                size="sm"
                formAction={sendMagicLink}
                formNoValidate
                disabled={!configured}
                pendingLabel={c.common.actions.loading}
              >
                {t.magicLink}
              </SubmitButton>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
