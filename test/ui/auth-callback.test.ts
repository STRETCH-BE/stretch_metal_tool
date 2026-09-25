/**
 * Magic-link callback: redirects must survive a reverse proxy. In a route
 * handler request.url / nextUrl.origin are the server's bind address
 * (http://localhost:PORT), so the handler answers with a RELATIVE Location
 * that the browser resolves against the public origin it requested.
 * File path: /test/ui/auth-callback.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { GET } from "@/app/auth/callback/route";

const PUBLIC_ORIGIN = "https://quote.stretchmetal.pl";

/** What `next start -p 3123` behind a proxy sees: bind host in the URL, public host in headers. */
function proxied(pathAndQuery: string): NextRequest {
  return new NextRequest(`http://localhost:3123${pathAndQuery}`, {
    headers: {
      host: "quote.stretchmetal.pl",
      "x-forwarded-host": "quote.stretchmetal.pl",
      "x-forwarded-proto": "https",
    },
  });
}

function resolvedAgainstPublicOrigin(location: string, requestPath: string): string {
  return new URL(location, `${PUBLIC_ORIGIN}${requestPath}`).href;
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    createClient.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  });

  it("sends a successful exchange to `next` on the public origin, never localhost", async () => {
    const exchange = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({ auth: { exchangeCodeForSession: exchange } });
    const path = "/auth/callback?code=abc&next=%2Fquotes%2F1";

    const response = await GET(proxied(path));
    const location = response.headers.get("location");

    expect(response.status).toBe(307);
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(location).toBe("/quotes/1");
    expect(location).not.toMatch(/localhost/);
    expect(resolvedAgainstPublicOrigin(location!, path)).toBe(`${PUBLIC_ORIGIN}/quotes/1`);
  });

  it("goes back to /login?error=callback without a code, without touching Supabase", async () => {
    const path = "/auth/callback?next=%2Fquotes%2F1";
    const response = await GET(proxied(path));
    const location = response.headers.get("location");
    expect(location).toBe("/login?error=callback");
    expect(location).not.toMatch(/localhost/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("goes back to /login?error=callback when the exchange fails", async () => {
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: { message: "expired" } }) },
    });
    const response = await GET(proxied("/auth/callback?code=old"));
    expect(response.headers.get("location")).toBe("/login?error=callback");
  });

  it("drops an external or protocol-relative `next`", async () => {
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
    });
    for (const next of ["//evil.example", "https://evil.example/x", "\\\\evil.example"]) {
      const response = await GET(proxied(`/auth/callback?code=abc&next=${encodeURIComponent(next)}`));
      expect(response.headers.get("location"), next).toBe("/");
    }
  });

  it("fails cleanly when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await GET(proxied("/auth/callback?code=abc"));
    expect(response.headers.get("location")).toBe("/login?error=callback");
    expect(createClient).not.toHaveBeenCalled();
  });
});
