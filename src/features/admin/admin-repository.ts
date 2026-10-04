import type { CaseDefinition, Difficulty, PublicationStatus } from "@/lib/engine/types";
import type { Condition } from "@/features/case-manager/conditions";
import type { ExistingCase } from "@/features/case-manager/duplicates";
import type { CaseDraft, CaseDraftContent } from "./draft";

export const CASE_SORTS = ["updated_desc", "updated_asc", "title_asc", "number_desc", "code_asc"] as const;
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
  caseCode: string;
  title: string;
  slug: string;
  domain: string;
  category: string | null;
  subcategory: string;
  difficulty: Difficulty;
  status: PublicationStatus;
  stageCount: number;
  maxLives: number;
  updatedAt: string;
  author: string | null;
  hasUnpublishedChanges: boolean;
  publishedVersion: number | null;
};

export type DashboardData = {
  counts: Record<PublicationStatus, number> & { total: number };
  recentCases: CaseListItem[];
};

export type DomainRow = { id: string; name: string; slug: string; domainType: string; isActive: boolean; caseCount: number };
export type CategoryRow = { id: string; domainId: string; domainName: string; name: string; slug: string; isActive: boolean; caseCount: number };

export type SaveResult =
  | { status: "saved"; revision: number; updatedAt: string; hasUnpublishedChanges: boolean }
  | { status: "conflict" }
  | { status: "not_found" };

export type SnapshotNames = { domainName: string; categoryName: string | null };

export type WriteOptions = {
  /** Only SUPER_ADMIN and ADMIN may add a new category (the database enforces the same rule). */
  allowCreateCategory: boolean;
};

/**
 * Authoring data access. Every method runs AS the given user (role `authenticated` + their user ID),
 * so Row Level Security and the publish trigger apply in addition to AdminCaseService's own checks.
 * Works with the approved schema only (migrations 0100 and 0200); no further migration is required.
 */
export interface AdminRepository {
  dashboard(userId: string): Promise<DashboardData>;
  listCases(userId: string, query: CaseListQuery, maxPageSize?: number): Promise<{ items: CaseListItem[]; total: number }>;
  getDraft(userId: string, caseId: string): Promise<CaseDraft | null>;
  /** Draft plus the names needed to build a snapshot. */
  getDraftWithNames(userId: string, caseId: string): Promise<{ draft: CaseDraft; names: SnapshotNames } | null>;
  /** Inserts a new DRAFT case (used by Create, Import and Duplicate). */
  createCase(userId: string, content: CaseDraftContent, options: WriteOptions): Promise<string>;
  saveDraft(userId: string, caseId: string, content: CaseDraftContent, expectedRevision: number, options: WriteOptions): Promise<SaveResult>;
  /** Builds and stores the next version inside one transaction. `build` validates and may throw. */
  publish(userId: string, caseId: string, build: (draft: CaseDraft, names: SnapshotNames, version: number) => CaseDefinition): Promise<{ version: number } | null>;
  setStatus(userId: string, caseId: string, status: PublicationStatus): Promise<boolean>;

  listDomains(userId: string): Promise<DomainRow[]>;
  listCategories(userId: string): Promise<CategoryRow[]>;
  findDomainByName(userId: string, name: string): Promise<{ id: string; name: string } | null>;
  findCategory(userId: string, domainId: string, name: string): Promise<{ id: string; name: string } | null>;
  /** The case currently using this Case ID (case-insensitive), if any. */
  findByCaseCode(userId: string, caseCode: string, exceptCaseId?: string): Promise<{ id: string; title: string } | null>;

  /** Light fingerprints of every case (no clue text), for duplicate checks. */
  duplicateCandidates(userId: string, exceptCaseId?: string): Promise<ExistingCase[]>;
  /** Clue text per case, for a short list of candidates (one query). */
  clueTexts(userId: string, caseIds: readonly string[]): Promise<Map<string, string>>;
  /** Diagnosis and differential names written in medical cases, for the condition inventory. */
  conditionsFromCases(userId: string): Promise<Condition[]>;
}
