/**
 * /guide — the PUBLIC DXF export guide (middleware allow-list), outside
 * the app shell: dark hero + light sections in the STRETCH identity.
 * File path: /app/guide/page.tsx
 *
 * Locale from getPublicLocale (cookie → Accept-Language) with the PL / EN
 * switch (setLocale cookie). Per-CAD steps, the recognised layer table
 * generated from lib/geometry DEFAULT_LAYER_CONVENTIONS, the checklist,
 * the PDF companion, the example DXF download (static /downloads file)
 * and a link to the login page. All copy from content/guide.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getPublicLocale } from "@/lib/i18n";
import { getContent } from "@/content";
import { routes } from "@/lib/routes";
import { siteConfig } from "@/lib/site-config";
import { DEFAULT_LAYER_CONVENTIONS } from "@/lib/geometry/layer-conventions";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Logo } from "@/components/ui/logo";
import { SectionTitle } from "@/components/ui/section-title";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";

export async function generateMetadata(): Promise<Metadata> {
  const c = getContent(await getPublicLocale());
  return { title: c.guide.meta.title, description: c.guide.meta.description };
}

export default async function GuidePage() {
  const c = getContent(await getPublicLocale());
  const g = c.guide;
  const layerRows: { role: string; layers: string[] }[] = [
    { role: g.layers.roles.bendUp, layers: DEFAULT_LAYER_CONVENTIONS.bendUp },
    { role: g.layers.roles.bendDown, layers: DEFAULT_LAYER_CONVENTIONS.bendDown },
    { role: g.layers.roles.engrave, layers: DEFAULT_LAYER_CONVENTIONS.engrave },
    { role: g.layers.roles.weld, layers: DEFAULT_LAYER_CONVENTIONS.weld },
    { role: g.layers.roles.cut, layers: DEFAULT_LAYER_CONVENTIONS.cut },
    { role: g.layers.roles.ignore, layers: DEFAULT_LAYER_CONVENTIONS.ignore },
  ];

  return (
    <main id="main" className="flex min-h-dvh flex-col">
      <header className="section-dark">
        <div className="flex items-center justify-between border-b border-line-dark px-6" style={{ height: "var(--header-h)" }}>
          <Logo ariaLabel={c.common.app.logoAria} suffix="QUOTE" href={routes.guide} size={22} />
          <div className="flex items-center gap-4">
            <LocaleSwitcher tone="dark" />
            <Link href={routes.login} className="btn btn-ghost-light btn-sm">
              {g.footer.login}
            </Link>
          </div>
        </div>
        <Container className="section">
          <Eyebrow number="01">{g.hero.eyebrow}</Eyebrow>
          <SectionTitle as="h1" size="display">
            {g.hero.title} <span className="text-red">{g.hero.titleAccent}</span>
          </SectionTitle>
          <p className="lead mt-8 max-w-2xl">{g.hero.lead}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href={routes.guideExampleDxf} download={g.example.fileName} className="btn btn-primary">
              {g.hero.downloadExample}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </a>
            <Button href={routes.login} variant="ghost-light">
              {g.hero.login}
            </Button>
          </div>
        </Container>
      </header>

      <section className="section-surface section-sm">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Eyebrow number="02">{g.why.eyebrow}</Eyebrow>
            <SectionTitle size="section-sm">{g.why.title}</SectionTitle>
            <p className="lead mt-6">{g.why.body}</p>
          </div>
          <ul className="grid-lines self-end">
            {g.why.points.map((point) => (
              <li key={point} className="flex items-start gap-3 bg-white px-5 py-4 text-[15px]">
                <span className="tick mt-[7px]" aria-hidden="true" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="section-sm bg-white">
        <Container>
          <Eyebrow number="03">{g.cad.eyebrow}</Eyebrow>
          <SectionTitle size="section-sm">{g.cad.title}</SectionTitle>
          <p className="lead mt-6 max-w-3xl">{g.cad.intro}</p>
          <div className="grid-lines mt-10 md:grid-cols-2 xl:grid-cols-3">
            {g.cad.systems.map((system) => (
              <article key={system.key} className="flex flex-col gap-4 bg-white p-6">
                <h3 className="h3">{system.name}</h3>
                <ol className="flex flex-col gap-2 text-[14.5px] leading-relaxed text-text-body">
                  {system.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="eyebrow-num shrink-0" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {system.note && <p className="border-t border-border pt-3 text-[13px] text-text-muted">{system.note}</p>}
              </article>
            ))}
          </div>
        </Container>
      </section>

      <section className="section-surface section-sm">
        <Container>
          <Eyebrow number="04">{g.layers.eyebrow}</Eyebrow>
          <SectionTitle size="section-sm">{g.layers.title}</SectionTitle>
          <p className="lead mt-6 max-w-3xl">{g.layers.intro}</p>
          <div className="panel mt-8 overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">{g.layers.columns.role}</th>
                  <th scope="col">{g.layers.columns.layers}</th>
                </tr>
              </thead>
              <tbody>
                {layerRows.map((row) => (
                  <tr key={row.role}>
                    <td className="font-bold">{row.role}</td>
                    <td>
                      <span className="flex flex-wrap gap-2">
                        {row.layers.map((layer) => (
                          <code key={layer} className="kbd">
                            {layer}
                          </code>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[13px] text-text-muted">
            {g.layers.prefixNote} {g.layers.caseNote}
          </p>
        </Container>
      </section>

      <section className="section-sm bg-white">
        <Container className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow number="05">{g.checklist.eyebrow}</Eyebrow>
            <SectionTitle size="section-sm">{g.checklist.title}</SectionTitle>
            <ol className="mt-8 flex flex-col gap-3">
              {g.checklist.items.map((item, i) => (
                <li key={item} className="flex items-start gap-3 border-b border-border pb-3 text-[15px]">
                  <span className="eyebrow-num shrink-0" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <Eyebrow number="06">{g.pdf.eyebrow}</Eyebrow>
            <SectionTitle size="section-sm">{g.pdf.title}</SectionTitle>
            <p className="lead mt-6">{g.pdf.body}</p>
            <ul className="mt-6 flex flex-col gap-2">
              {g.pdf.items.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px]">
                  <span className="tick mt-[7px]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="section-dark section-sm">
        <Container className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <Eyebrow number="07">{g.example.eyebrow}</Eyebrow>
            <SectionTitle size="section-sm">{g.example.title}</SectionTitle>
            <p className="lead mt-6">{g.example.body}</p>
          </div>
          <div className="flex flex-col items-start gap-3">
            <a href={routes.guideExampleDxf} download={g.example.fileName} className="btn btn-primary">
              {g.example.download}
              <span aria-hidden="true" className="btn-arrow">
                →
              </span>
            </a>
            <code className="kbd border-line-dark bg-black text-on-dark-soft">{g.example.fileName}</code>
          </div>
        </Container>
      </section>

      <footer className="section-dark border-t border-line-dark">
        <Container className="flex flex-col gap-4 py-8 md:flex-row md:items-center md:justify-between">
          <p className="max-w-xl text-[13.5px] text-on-dark-muted">{g.footer.loginHelp}</p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={siteConfig.websiteUrl} className="lnk text-[13px] font-bold tracking-[0.12em] text-on-dark-soft uppercase" target="_blank" rel="noreferrer">
              {g.hero.website}
            </a>
            <Button href={routes.login} variant="ghost-light" size="sm" arrow>
              {g.footer.login}
            </Button>
          </div>
        </Container>
      </footer>
    </main>
  );
}
