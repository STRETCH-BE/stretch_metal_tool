/**
 * ActionRunner — the builder's "run a server action in a transition and
 * toast the outcome" callback, typed so children (assembly editor, seams
 * editor, forming editor) can run any action whose result is
 * `{ ok: true, … } | { ok: false, error, message? }` and choose the
 * success toast from the result (e.g. "added" vs "paired, not counted").
 * File path: /components/quote/action-runner.ts
 */

import type { QuoteErrorCode } from "@/lib/quotes/schema";

export type ActionFailure = { ok: false; error: QuoteErrorCode; message?: string };
export type ActionLike = { ok: true } | ActionFailure;

export type ActionRunner = <R extends ActionLike>(
  fn: () => Promise<R>,
  success: string | ((result: Exclude<R, ActionFailure>) => string)
) => void;
