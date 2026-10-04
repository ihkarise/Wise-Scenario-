import { NextResponse, type NextRequest } from "next/server";
import { actorFromGuestCookie, can, GUEST_COOKIE } from "@/lib/auth/actor";

/**
 * First authorization gate for admin areas, evaluated before any admin page or API renders.
 * Pages and services check permissions again on the server (defence in depth); hiding links is never relied on.
 * Milestone 2 swaps the guest cookie for a Supabase session with roles from `user_roles`.
 */
export function proxy(request: NextRequest) {
  const actor = actorFromGuestCookie(request.cookies.get(GUEST_COOKIE)?.value);
  if (can(actor, "admin:access")) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "You do not have permission to do that." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.rewrite(new URL("/forbidden", request.url), { status: 403 });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
