"use client";

/**
 * Locale + content context for client components.
 * File path: /components/providers/locale.tsx
 *
 * The app layout resolves the locale on the server and passes the whole
 * dictionary down once; client components call `useContent()` /
 * `useLocale()` instead of importing dictionaries directly, so a user's
 * language preference applies everywhere without prop drilling.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { Content } from "@/content";
import type { Locale } from "@/lib/site-config";

const LocaleContext = createContext<Content | null>(null);

export function LocaleProvider({
  content,
  children,
}: {
  content: Content;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={content}>{children}</LocaleContext.Provider>
  );
}

export function useContent(): Content {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useContent() must be used inside <LocaleProvider>.");
  }
  return value;
}

export function useLocale(): Locale {
  return useContent().locale;
}
