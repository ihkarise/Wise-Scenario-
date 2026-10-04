import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-views";

export const metadata: Metadata = { title: "Administrators only", robots: { index: false, follow: false } };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <ErrorState
        title="Administrators only"
        message="You need an administrator account to open this area. Sign-in for administrators arrives in the next milestone."
        action={
          <Link href="/play" className={buttonClasses("secondary")}>
            Back to cases
          </Link>
        }
      />
    </div>
  );
}
