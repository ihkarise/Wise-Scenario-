"use client";

import { useMemo } from "react";
import { toCaseSummary } from "@/features/cases/case-repository";
import type { PlayerApi } from "@/features/player/api-client";
import { CasePlayer } from "@/features/player/components/case-player";
import { beginAttempt, createAttempt, submitAnswer, toPlayerView, type CaseAttempt, type CaseDefinition, type EngineErrorCode } from "@/lib/engine";
import { uuidv4 } from "@/lib/utils/uuid";

const MESSAGES: Partial<Record<EngineErrorCode, string>> = {
  STALE_STATE: "Your answer was already received. Showing the latest state.",
  OPTION_ALREADY_TRIED: "That answer option is not available for this clue.",
};

/**
 * "Preview as learner": the real CasePlayer (same screens, lives, score, feedback and result) driven by
 * the same pure engine, using the saved draft the server sent to this staff-only page. Nothing is
 * stored: no attempt, score or history is created.
 */
export function PreviewPlayer({ snapshot }: { snapshot: CaseDefinition }) {
  const api = useMemo<PlayerApi>(() => {
    // Held only in this browser tab, for this preview. Never sent anywhere or stored.
    const session: { attempt: CaseAttempt | null } = { attempt: null };
    return {
      start: async () => {
        const attempt = beginAttempt(createAttempt(snapshot, { attemptId: uuidv4(), ownerId: "preview" }), new Date());
        session.attempt = attempt;
        return { ok: true, data: { view: toPlayerView(snapshot, attempt) } };
      },
      get: async () =>
        session.attempt ? { ok: true, data: { view: toPlayerView(snapshot, session.attempt) } } : { ok: false, code: "ATTEMPT_NOT_FOUND", message: "Start the preview again." },
      submit: async (_id, body) => {
        if (!session.attempt) return { ok: false, code: "ATTEMPT_NOT_FOUND", message: "Start the preview again." };
        const out = submitAnswer(snapshot, session.attempt, body, { now: new Date() });
        if (!out.ok) return { ok: false, code: "INVALID_ANSWER", message: MESSAGES[out.error.code] ?? "That answer could not be accepted." };
        session.attempt = out.attempt;
        return { ok: true, data: { view: toPlayerView(snapshot, out.attempt), duplicate: out.duplicate } };
      },
    };
  }, [snapshot]);

  return <CasePlayer summary={toCaseSummary(snapshot)} initialView={null} api={api} />;
}
