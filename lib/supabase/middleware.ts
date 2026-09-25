/**
 * Session refresh for Next.js middleware.
 * File path: /lib/supabase/middleware.ts
 *
 * Standard @supabase/ssr pattern: rebuild the response so refreshed auth
 * cookies reach both the server components of this request and the
 * browser. Returns the user (or null) so /middleware.ts can gate routes.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/types";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { response, user: null, configured: false as const };
  }

  const supabase = createServerClient<Database>(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() validates the JWT against Supabase Auth — never trust getSession() here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, configured: true as const };
}
