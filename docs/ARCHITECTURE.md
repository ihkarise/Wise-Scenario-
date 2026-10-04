# WiseCases architecture

This describes what exists after **Milestone 1**. The original plan is in [MILESTONE-0-REPORT.md](MILESTONE-0-REPORT.md) and the interactive [blueprint](blueprint/index.html).

## The rule that shapes everything

The browser is never trusted with correct answers, future clues, lives, score, stage progression, completion or publication status.

```
PLAYER (browser)                         SERVER (Next.js route handlers)
────────────────                         ───────────────────────────────
open /case/[slug]  ───────────────────►  load case on the server, find any in-progress attempt
                   ◄───────────────────  content-free summary + PlayerView (current stage only)
POST /api/attempts { caseSlug }  ─────►  create or resume attempt (server picks lives, stage)
                   ◄───────────────────  PlayerView
POST /api/attempts/:id/answers    ────►  load attempt + pinned case version
  { submissionId, stageId,               check owner, published, revision, stage, option
    optionId, expectedRevision }         run pure engine → save with compare-and-swap
                   ◄───────────────────  next PlayerView (next stage, retry, or result)
```

The browser may send only: a case slug, an attempt ID, a stage ID, an option ID, an idempotency key and the revision it was shown. Request bodies are **strict**, so a request that also contains `livesRemaining`, `score`, `isCorrect`, `completed`, `currentStage` or `status` is rejected with 400.

## Layers

| Layer | Location | Knows about |
|---|---|---|
| Pure engine | `src/lib/engine/` | Cases, stages, options, attempts. No I/O, React, clocks or randomness. |
| Validation | `src/lib/schemas/` | Zod schemas for case content and API bodies |
| Services | `src/features/attempts/attempt-service.ts` | Repositories + engine. Ownership, publication, concurrency |
| Repositories | `src/features/*/…-repository.ts` | Interfaces; in-memory implementations for M1, Supabase in M2 |
| HTTP | `src/features/attempts/http/`, `src/app/api/` | Parsing, cookies, error mapping. Thin |
| UI | `src/components/ui/`, `src/features/player/` | Renders PlayerView. Holds only "selected option" and "request in flight" |
| Wiring | `src/lib/server/container.ts` | The only place that picks repository implementations |

```
src/
├── app/                      routes: /, /play, /case/[slug], /admin, /forbidden, /api/attempts/…
├── proxy.ts                  first admin gate (403 before any admin page renders)
├── components/ui/            Button, Card, Badge, Input, Select, LifeIndicator, ProgressIndicator,
│                             AnswerOption, StageCard, Loading/Error/Empty states
├── components/layout/        header, footer
├── features/
│   ├── cases/                CaseRepository, in-memory repo, demo cases, CaseCard
│   ├── attempts/             AttemptRepository, in-memory repo, AttemptService, HTTP handlers
│   └── player/               API client, useCasePlayer hook, player components
└── lib/
    ├── engine/               types, engine, scoring, view projection, errors (+ tests)
    ├── schemas/              Zod: IDs, case content, API bodies
    ├── auth/                 roles, permissions, actor
    ├── server/               container, HTTP helpers, service errors
    └── utils/
supabase/                     migrations, seed, rollback, RLS tests
tests/support/                fixtures shared by tests
```

The engine does not know about domains. Medical diagnosis, materia medica, repertory and anatomy cases all go through the same code: **case → stage → clue → question → options → answer → life → next state → result**.

## Content vs attempt state

- **Content** (`CaseDefinition`, `CaseStage`, `AnswerOption`, teaching, references) is identical for every learner and never holds learner data.
- **Attempt** (`CaseAttempt`, `AnswerRecord`) holds attempt ID, owner, pinned case version, current stage, lives, answers, score, status, start and completion times, and a revision counter.

Attempts are pinned to the case **version** they started on. Editing a published case later never changes a game in progress.

## Case state machine

```
NOT_STARTED ──begin──► IN_PROGRESS ──submit──► ANSWER_SUBMITTED (transient, never stored)
                            ▲                         │
                            │                         ├── correct ─────────────────────► COMPLETED_SUCCESS
                            │                         │
                            │                         └── wrong: lives −= stage.lifeCost
                            │                               ├── lives = 0 ─────────────► COMPLETED_FAILED (OUT_OF_LIVES, answer revealed)
                            ├── next stage ◄────────────────┤ lives > 0, another stage exists
                            │                               │
                            └── stay on final ◄─────────────┘ lives > 0, final stage → case.terminalBehavior
```

| Transition | Condition | Result |
|---|---|---|
| NOT_STARTED → IN_PROGRESS | learner starts | lives = `maxLives`, stage 1 |
| ANSWER_SUBMITTED → COMPLETED_SUCCESS | option is correct | no life lost; score calculated |
| ANSWER_SUBMITTED → COMPLETED_FAILED | wrong and lives reach 0 | `OUT_OF_LIVES`; answer always revealed |
| ANSWER_SUBMITTED → IN_PROGRESS | wrong, lives remain, next stage exists | advance; new clue and new options |
| ANSWER_SUBMITTED → per terminal behaviour | wrong on final stage, lives remain | see below |

**Correct answer = case solved** (`completionMode: FIRST_CORRECT`). Multi-step reasoning modes, such as repertory totality, are added later as new `completionMode` values without changing the existing ones.

### Final-stage behaviour (`terminalBehavior`)

Applies only when the **final** stage is answered wrongly and lives remain. Running out of lives always ends the case and reveals the answer.

| Value | Behaviour |
|---|---|
| `REVEAL_ANSWER` (default) | End as failed and reveal the answer and teaching |
| `END_CASE` | End as failed **without** revealing the answer, so the learner can retry later |
| `RETRY_FINAL_STAGE` | Stay on the final stage; the wrong option is struck out. It always ends: each retry costs a life and removes an option |
| `ALLOW_FINAL_ATTEMPT` | Exactly one more try at the final stage, then end and reveal |

Other per-case settings: `maxLives` (1–20), per-stage `lifeCost` (0 = free guess), per-stage `showPreviousClues`, and `revealCorrectOptionOnWrong` (default off).

## Scoring

One function, `calculateScore` in `src/lib/engine/scoring.ts`:

```
score = round(base × difficultyMultiplier × clueEfficiency × lifeMultiplier)
clueEfficiency = 1 − clueWeight × (stageIndexSolved / stageCount)
lifeMultiplier = (1 − lifeWeight) + lifeWeight × (livesRemaining / maxLives)
defaults: base 1000 · Easy 1.0 / Intermediate 1.25 / Hard 1.5 · clueWeight 0.5 · lifeWeight 0.5
```

A failed case scores 0. Time is stored but not scored, so results stay deterministic. Milestone 8 moves the numbers to a `scoring_rules` table.

## Double submission and concurrency

1. **UI:** a synchronous lock plus a disabled, busy Submit button.
2. **Idempotency key:** each answer carries a `submissionId` (UUID). Re-sending it returns the original result and costs nothing. A network retry reuses the same key.
3. **Revision check:** each answer carries the revision the learner saw. A second click with a new key but an old revision is rejected as stale.
4. **Compare-and-swap save:** the repository saves only if the stored revision is unchanged. A lost race is re-evaluated once and resolves as a duplicate or stale request.
5. **Database (M2):** `unique (attempt_id, submission_id)`, `unique (attempt_id, sequence)` and one in-progress attempt per learner per case.

## What the browser receives (`PlayerView`)

`toPlayerView` in `src/lib/engine/view.ts` is the only shape of attempt data that leaves the server. It picks fields explicitly and never spreads content objects:

- current stage: clue, question, hint and options as `{ id, label, tried }`, with no correctness flag;
- earlier clues the learner has already earned (if the stage shows them);
- nothing from stages not yet reached;
- answer, explanation, differentials, learning points and references only after completion, and only when the answer is revealed;
- the learner's own last answer, as `wasCorrect` (the key `isCorrect` never appears in a response).

## Errors

Services throw `ServiceError` with a code and HTTP status (`src/lib/server/service-error.ts`). Responses contain only `{ error: { code, message } }` with plain-language messages; internal details are logged, never returned. Drafts, archived and missing cases all return `CASE_UNAVAILABLE` (404), so draft slugs cannot be discovered. Another learner's attempt returns `ATTEMPT_NOT_FOUND` (404).

## Future API boundary

Other Wise products should call services (or HTTP endpoints built on them), never the tables. Planned boundaries: `CaseCatalogue` (published summaries), `AttemptService` (play), `CaseAuthoring` (M3), `Analytics` (M7).
