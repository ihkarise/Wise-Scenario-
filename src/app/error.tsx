"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-views";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Something went wrong"
      message="We could not load this page. Please try again."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
