import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "@/lib/auth/supabase-route";

/** POST only, from a same-site form: signing out cannot be triggered by a cross-site link. */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const supabase = await createSupabaseRouteClient();
  await supabase?.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
