import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state-views";

export default function NotFound() {
  return (
    <EmptyState
      title="This page or case is not available"
      message="It may have been moved, unpublished, or never existed."
      action={
        <Link href="/play" className={buttonClasses("primary")}>
          Browse cases
        </Link>
      }
    />
  );
}
