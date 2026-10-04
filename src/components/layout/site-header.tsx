import Link from "next/link";
import { isStaff } from "@/lib/auth/actor";
import { getRequestActor } from "@/lib/server/request-actor";

const navLink = "rounded-lg px-3 py-2 text-ink-muted hover:bg-blue-soft hover:text-wise-blue";

export async function SiteHeader() {
  const actor = await getRequestActor().catch(() => null);
  const signedIn = actor?.kind === "user";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-navy">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
            <path
              d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.1 1.8-1.9 3.3-3.1 5.4-3.1 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"
              className="fill-wise-red"
            />
          </svg>
          WiseCases
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center justify-end gap-1 text-sm font-semibold">
          <Link href="/play" className={navLink}>
            Cases
          </Link>
          {isStaff(actor) && (
            <Link href="/admin" className={navLink}>
              Admin
            </Link>
          )}
          {signedIn ? (
            <>
              <Link href="/account" className={navLink}>
                Account
              </Link>
              <form action="/auth/sign-out" method="post">
                <button type="submit" className={`${navLink} cursor-pointer`}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/sign-in" className={navLink}>
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
