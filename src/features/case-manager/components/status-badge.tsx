import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/features/admin/draft";
import type { PublicationStatus } from "@/lib/engine/types";

const TONE = { DRAFT: "neutral", READY_FOR_REVIEW: "amber", REVIEWED: "blue", PUBLISHED: "teal", ARCHIVED: "red" } as const;

export function StatusBadge({ status, changed = false }: { status: PublicationStatus; changed?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
      {changed && <Badge tone="amber">Unpublished changes</Badge>}
    </span>
  );
}
