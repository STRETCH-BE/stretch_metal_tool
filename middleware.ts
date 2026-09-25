/**
 * Route protection + session refresh.
 * File path: /middleware.ts
 *
 * Everything requires a signed-in user except:
 *   /login            — the sign-in page
 *   /guide            — the public DXF export guide (linked from the website)
 *   /api/health       — uptime probe
 *   /auth/callback    — magic-link / password-reset landing
 * Static assets and Next internals are excluded by the matcher.
 *
 * Unauthenticated requests to pages redirect to /login?next=<path>;
 * unauthenticated API calls get a JSON 401. Role checks happen in the
 * pages/actions themselves (lib/auth.ts) — middleware only knows "signed in".
 */

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/guide", "/api/health", "/auth/callback"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user, configured } = await updateSession(request);

  if (isPublic(pathname)) {
    // A signed-in user landing on /login goes straight to the app.
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: configured ? "unauthenticated" : "supabase_not_configured" },
        { status: 401 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and Next internals:
     * _next/static, _next/image, favicon, icons, fonts, images.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|fonts/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
