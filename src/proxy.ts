import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page and API route:
 *  1. Refreshes the Supabase sign-in session cookies when needed (server components cannot write cookies).
 *  2. Keeps signed-out visitors out of admin areas (redirect for pages, 401 for APIs).
 * Role checks (staff / SUPER_ADMIN) happen on the server for every admin page and API call, and again
 * in the database through Row Level Security. Hiding links is never the control.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let signedIn = false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSessionCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (url && key && hasSessionCookie) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  const path = request.nextUrl.pathname;
  if (!signedIn && path.startsWith("/api/admin")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in with an administrator account." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!signedIn && (path === "/admin" || path.startsWith("/admin/"))) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", path);
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
