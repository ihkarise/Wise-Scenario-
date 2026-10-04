import { z } from "zod";
import { contentIdSchema, slugSchema, uuidSchema } from "./ids";

/**
 * Request bodies the browser may send. Objects are STRICT: any extra field such as
 * `livesRemaining`, `score`, `isCorrect`, `completed` or `currentStage` makes the request invalid.
 */
export const startAttemptBodySchema = z.strictObject({
  caseSlug: slugSchema,
});

export const submitAnswerBodySchema = z.strictObject({
  submissionId: uuidSchema,
  stageId: contentIdSchema,
  optionId: contentIdSchema,
  expectedRevision: z.int().min(0),
});

export const attemptIdSchema = uuidSchema;

export type StartAttemptBody = z.infer<typeof startAttemptBodySchema>;
export type SubmitAnswerBody = z.infer<typeof submitAnswerBodySchema>;
