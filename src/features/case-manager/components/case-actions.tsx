"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PublicationStatus } from "@/lib/engine/types";
import { adminRequest } from "../admin-api";

type Props = {
  caseId: string;
  title: string;
  status: PublicationStatus;
  hasUnpublishedChanges: boolean;
  canEdit: boolean;
  canPublish: boolean;
  /** Compact = inventory rows; full = the case page. */
  compact?: boolean;
};

/**
 * Duplicate, publish, unpublish, archive and restore. Buttons are shown only where the role allows,
 * but the server and the database make the real decision on every click.
 */
export function CaseActions({ caseId, title, status, hasUnpublishedChanges, canEdit, canPublish, compact = false }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, confirmText: string | null, fn: () => Promise<void>) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    setError(null);
    await fn();
    setBusy(null);
  };
  const action = (name: string, confirmText: string) =>
    run(name, confirmText, async () => {
      const res = await adminRequest(`/api/admin/cases/${caseId}/action`, { method: "POST", body: { action: name } });
      if (!res.ok) setError([res.message, ...res.issues].join(" "));
      else router.refresh();
    });

  const size = compact ? "min-h-9 px-3 text-xs" : undefined;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button
            variant="secondary"
            className={size}
            loading={busy === "duplicate"}
            onClick={() =>
              run("duplicate", `Make a copy of “${title}” as a new draft? The original is not changed.`, async () => {
                const res = await adminRequest<{ caseId: string }>(`/api/admin/cases/${caseId}/duplicate`, { method: "POST", body: {} });
                if (!res.ok) setError(res.message);
                else router.push(`/admin/cases/${res.data.caseId}/edit`);
              })
            }
          >
            Duplicate
          </Button>
        )}
        {canPublish && status !== "ARCHIVED" && (status !== "PUBLISHED" || hasUnpublishedChanges) && (
          <Button
            className={size}
            loading={busy === "publish"}
            onClick={() =>
              action(
                "publish",
                status === "PUBLISHED"
                  ? `Publish the changes to “${title}”? Learners will play the new version. Games already in progress keep the old version.`
                  : `Publish “${title}”? It will appear in the learner Case Library.`,
              )
            }
          >
            {status === "PUBLISHED" ? "Publish changes" : "Publish"}
          </Button>
        )}
        {canPublish && status === "PUBLISHED" && (
          <Button variant="secondary" className={size} loading={busy === "unpublish"} onClick={() => action("unpublish", `Unpublish “${title}”? Learners will no longer see it.`)}>
            Unpublish
          </Button>
        )}
        {status !== "ARCHIVED" && (status === "PUBLISHED" ? canPublish : canEdit) && (
          <Button variant="ghost" className={size} loading={busy === "archive"} onClick={() => action("archive", `Archive “${title}”? It is kept, not deleted, and can be restored.`)}>
            Archive
          </Button>
        )}
        {status === "ARCHIVED" && canEdit && (
          <Button variant="ghost" className={size} loading={busy === "restore"} onClick={() => action("restore", `Restore “${title}” as a draft?`)}>
            Restore
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-wise-red">
          {error}
        </p>
      )}
    </div>
  );
}
