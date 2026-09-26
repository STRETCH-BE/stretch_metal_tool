/**
 * Relative age of an override request ("just now", "12 min", "3 h", "2 d").
 * File path: /components/admin/override-age.ts
 *
 * Pure; templates come from content.admin.overrides.age. Kept out of the
 * page file because Next only allows the page exports there.
 */

import type { Content } from "@/content";
import { interpolate } from "@/lib/format";

export function ageText(content: Content, createdAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
  const t = content.admin.overrides.age;
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return interpolate(t.minutes, { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return interpolate(t.hours, { count: hours });
  return interpolate(t.days, { count: Math.floor(hours / 24) });
}
