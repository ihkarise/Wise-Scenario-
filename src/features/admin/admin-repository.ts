import type { CaseAttempt, CaseDefinition, Difficulty, PublicationStatus } from "@/lib/engine/types";
import type { CaseDraft, CaseDraftContent, CreateCaseInput, DraftStage } from "./draft";

export const CASE_SORTS = ["updated_desc", "updated_asc", "title_asc", "number_desc"] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

export type CaseListQuery = {
  q?: string;
  domainId?: string;
  categoryId?: string;
  difficulty?: Difficulty;
  status?: PublicationStatus;
  sort: CaseSort;
  page: number;
  pageSize: number;
};

export type CaseListItem = {
  id: string;
  caseNumber: number;
  title: string;
  slug: string;
  domain: string;
  category: string | null;
  difficulty: Difficulty;
  status: PublicationStatus;
  stageCount: number;
  maxLives: number;
  updatedAt: string;
  author: string | null;
  hasUnpublishedChanges: boolean;
  publishedVersion: number | null;
};

export type ActivityItem = { id: number; action: string; summary: string; actorName: string | null; caseId: string | null; createdAt: string };

export type DashboardData = {
  counts: Record<PublicationStatus, number> & { total: number };
  recentCases: CaseListItem[];
  recentActivity: ActivityItem[];
};

export type DomainRow = { id: string; name: string; slug: string; domainType: string; isActive: boolean; caseCount: number };
export type CategoryRow = { id: string; domainId: string; domainName: string; name: string; slug: string; isActive: boolean; caseCount: number };

export type PreviewSession = { id: string; caseId: string; snapshot: CaseDefinition; attempt: CaseAttempt };

export type SaveResult =
  | { status: "saved"; revision: number; updatedAt: string; hasUnpublishedChanges: boolean }
  | { status: "conflict" }
  | { status: "not_found" };

export type SnapshotNames = { domainName: string; categoryName: string | null };

/**
 * Authoring data access. Every method runs AS the given user (role `authenticated` + their user ID),
 * so Row Level Security and the publish trigger apply in addition to AdminCaseService's own checks.
 */
export interface AdminRepository {
  dashboard(userId: string): Promise<DashboardData>;
  listCases(userId: string, query: CaseListQuery): Promise<{ items: CaseListItem[]; total: number }>;
  getDraft(userId: string, caseId: string): Promise<CaseDraft | null>;
  /** Draft plus the names needed to build a snapshot. */
  getDraftWithNames(userId: string, caseId: string): Promise<{ draft: CaseDraft; names: SnapshotNames } | null>;
  createCase(userId: string, input: CreateCaseInput & { slug: string; firstStage: DraftStage }): Promise<string>;
  saveDraft(userId: string, caseId: string, content: CaseDraftContent, expectedRevision: number): Promise<SaveResult>;
  duplicate(userId: string, caseId: string, newId: () => string): Promise<string | null>;
  /** Builds and stores the next version inside one transaction. `build` validates and may throw. */
  publish(userId: string, caseId: string, build: (draft: CaseDraft, names: SnapshotNames, version: number) => CaseDefinition): Promise<{ version: number } | null>;
  setStatus(userId: string, caseId: string, status: PublicationStatus, audit: { action: string; summary: string }): Promise<boolean>;
  slugExists(userId: string, slug: string, exceptCaseId?: string): Promise<boolean>;

  listDomains(userId: string): Promise<DomainRow[]>;
  listCategories(userId: string): Promise<CategoryRow[]>;
  createDomain(userId: string, input: { name: string; slug: string; domainType: string }): Promise<string>;
  createCategory(userId: string, input: { domainId: string; name: string; slug: string }): Promise<string>;

  createPreview(userId: string, session: PreviewSession): Promise<void>;
  getPreview(userId: string, sessionId: string): Promise<PreviewSession | null>;
  updatePreview(userId: string, sessionId: string, attempt: CaseAttempt, expectedRevision: number): Promise<boolean>;
}
