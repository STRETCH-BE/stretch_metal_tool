/**
 * Login server action: a malformed e-mail is rejected by zod before any
 * Supabase call, and the user lands back on /login?error=invalid.
 * File path: /test/ui/auth-action.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, redirect } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    // Mirrors Next: redirect() never returns.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));

import { sendMagicLink, signInWithPassword } from "@/lib/actions/auth";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("signInWithPassword", () => {
  beforeEach(() => {
    createClient.mockReset();
    redirect.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  });

  it("rejects an invalid e-mail without calling Supabase", async () => {
    await expect(
      signInWithPassword(form({ email: "not-an-email", password: "secret" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login?error=invalid");
    expect(createClient).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/login?error=invalid");
  });

  it("rejects an empty password without calling Supabase", async () => {
    await expect(
      signInWithPassword(form({ email: "sales@stretchmetal.pl", password: "" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login?error=invalid");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("keeps a safe `next` path and drops an external one", async () => {
    await expect(
      signInWithPassword(form({ email: "bad", password: "x", next: "/quotes/abc" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login?error=invalid&next=%2Fquotes%2Fabc");
    await expect(
      signInWithPassword(form({ email: "bad", password: "x", next: "//evil.example" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login?error=invalid");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("calls Supabase with the normalised e-mail when the input is valid", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({ auth: { signInWithPassword: signIn } });
    await expect(
      signInWithPassword(form({ email: "  Sales@StretchMetal.PL ", password: "secret" }))
    ).rejects.toThrow("NEXT_REDIRECT:/");
    expect(signIn).toHaveBeenCalledWith({
      email: "sales@stretchmetal.pl",
      password: "secret",
    });
  });

  it("redirects with error=config when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(
      signInWithPassword(form({ email: "sales@stretchmetal.pl", password: "secret" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login?error=config");
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("sendMagicLink", () => {
  beforeEach(() => {
    createClient.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  });

  it("rejects an invalid e-mail without calling Supabase", async () => {
    await expect(sendMagicLink(form({ email: "nope" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=validation"
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});
