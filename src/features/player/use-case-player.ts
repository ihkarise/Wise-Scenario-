"use client";

import { useCallback, useRef, useState } from "react";
import type { PlayerView } from "@/lib/engine/view";
import { uuidv4 } from "@/lib/utils/uuid";
import { playerApi, type ApiErrorCode } from "./api-client";

type Busy = "starting" | "submitting" | null;
type PlayerError = { code: ApiErrorCode; message: string } | null;

/** Errors after which the server state is re-fetched so the screen matches the truth. */
const RESYNC: ApiErrorCode[] = ["STALE_STATE", "INVALID_STAGE", "ATTEMPT_COMPLETED", "INVALID_ANSWER", "NO_LIVES_REMAINING"];

/**
 * Client state for the player. The view always comes from the server; this hook only tracks what the
 * learner has selected and whether a request is in flight.
 *
 * Double-submit protection, layer 1 (UI): a synchronous lock plus a disabled button.
 * Layer 2 (server): every answer carries an idempotency key and the revision the learner saw.
 * A network retry of the SAME answer reuses the same key, so it can never cost a second life.
 */
export function useCasePlayer(caseSlug: string, initialView: PlayerView | null) {
  const [view, setView] = useState<PlayerView | null>(initialView);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<PlayerError>(null);
  const lock = useRef(false);
  const pending = useRef<{ fingerprint: string; submissionId: string } | null>(null);

  const start = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy("starting");
    setError(null);
    const res = await playerApi.start(caseSlug);
    if (res.ok) {
      setView(res.data.view);
      setSelectedOptionId(null);
    } else {
      setError({ code: res.code, message: res.message });
    }
    setBusy(null);
    lock.current = false;
  }, [caseSlug]);

  const resync = useCallback(async (attemptId: string) => {
    const res = await playerApi.get(attemptId);
    if (res.ok) {
      setView(res.data.view);
      setSelectedOptionId(null);
    }
  }, []);

  const submit = useCallback(async () => {
    if (lock.current || !view?.current || !selectedOptionId) return;
    lock.current = true;
    setBusy("submitting");
    setError(null);

    const fingerprint = `${view.attemptId}:${view.revision}:${view.current.stageId}:${selectedOptionId}`;
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, submissionId: uuidv4() };

    const res = await playerApi.submit(view.attemptId, {
      submissionId: pending.current.submissionId,
      stageId: view.current.stageId,
      optionId: selectedOptionId,
      expectedRevision: view.revision,
    });

    if (res.ok) {
      pending.current = null;
      setView(res.data.view);
      setSelectedOptionId(null);
    } else {
      // Keep the pending key on network errors so pressing Submit again is a safe retry.
      if (res.code !== "NETWORK_ERROR") pending.current = null;
      setError({ code: res.code, message: res.message });
      if (RESYNC.includes(res.code)) await resync(view.attemptId);
    }
    setBusy(null);
    lock.current = false;
  }, [view, selectedOptionId, resync]);

  return { view, selectedOptionId, setSelectedOptionId, busy, error, start, submit };
}
