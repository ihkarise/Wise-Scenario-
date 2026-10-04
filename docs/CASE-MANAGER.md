# WiseCases Case Manager

The Case Manager lets staff create, edit, validate, preview, import, export and manage clinical cases without touching source code. It lives at **`/admin`** and is only available to signed-in staff (SUPER_ADMIN, ADMIN, EDITOR, REVIEWER).

```
Author → Edit → Preview → Validate → Publish (SUPER_ADMIN only)
```

## Who can do what

| Action | SUPER_ADMIN | ADMIN | EDITOR | REVIEWER | Learner / guest |
|---|---|---|---|---|---|
| Open the Case Manager, view cases, preview, export JSON | ✓ | ✓ | ✓ | ✓ | ✕ |
| Create, edit, duplicate, import, archive drafts | ✓ | ✓ | ✓ | ✕ | ✕ |
| Add a new category (while creating or importing) | ✓ | ✓ | ✕ | ✕ | ✕ |
| Publish, unpublish, archive a published case | ✓ | ✕ | ✕ | ✕ | ✕ |

Every rule is checked three times: the page hides what you cannot do, the server refuses it, and the database (Row Level Security and the publish trigger) refuses it again.

## Pages

| Page | What it does |
|---|---|
| `/admin` | **Case Manager** home: Create case · Import JSON · Download JSON template · Case inventory, counts by status, recently updated |
| `/admin/cases` | **Case inventory**: search (Case ID, title, category, subcategory), filters (status, difficulty, category), sorting, 25 per page, CSV export for spreadsheets |
| `/admin/cases/new` | Create a draft (title, Case ID, domain, category, subcategory, difficulty, lives) |
| `/admin/cases/[id]` | **View**: readiness report, possible duplicates, content overview, all actions |
| `/admin/cases/[id]/edit` | **Editor** with 10 collapsible sections (below) |
| `/admin/cases/[id]/preview` | **Preview as learner** with the real game screens |
| `/admin/import` | **Import JSON** workflow |
| `/admin/conditions` | **Condition inventory** search |

## The editor

1. **Basic information**: Case ID, title, web address, domain, category, subcategory, difficulty, starting lives, life loss per wrong answer, starting score, wrong-answer penalty, last-stage behaviour, summary, learning objective.
2. **Stages**: any number (1–50). Add, delete, move up/down. Each stage has a title, clue, decision point (question + answer options, one correct), optional hint, stage explanation, investigations and cross-reference.
3. **Diagnosis**: primary diagnosis (with autocomplete), display name, accepted answers, aliases, explanation, detailed explanation, decisive findings, final reasoning. A "Check an answer" box shows whether a typed answer would be accepted.
4. **Differential diagnoses**: name, aliases, why considered, why rejected, clinical explanation, cross-references.
5. **Wrong answer explanations**: condition, aliases, explanation, missed clues, better direction.
6. **Investigations**: overview of stage results, plus an investigation summary.
7. **Clinical reasoning**: clinical summary, diagnostic reasoning, where reasoning can go wrong.
8. **Clinical insight**.
9. **Learning points**.
10. **References** (with "I have checked this reference").

The bar at the bottom has **Save draft** (also Ctrl/Cmd+S), **Validate** (the same checks as import, plus duplicates), **Preview** and **Export JSON**. Leaving with unsaved changes asks first. If someone else saved the case in the meantime, saving is refused instead of overwriting their work.

## JSON import and export

Workflow: **Choose JSON file (or drag and drop) → parse → validate → check duplicates → review → confirm → create a DRAFT.**

- The format is defined by [`data/case-template.json`](../data/case-template.json) (download it from the Case Manager). Required: `id`, `title`, `category`, `difficulty`, `status`, `startingLives`, `startingScore`, at least one stage (`stageNumber`, `title`, `clue`) and `diagnosis` (`primary` + at least one `acceptedAnswers`).
- The report lists every check (✓ passed, i note, ! warning, ✕ problem). A file with any ✕ cannot be imported.
- Unknown fields are reported (to catch spelling mistakes) and ignored.
- `status` in the file is checked but **imported cases are always drafts**.
- A stage without `decisionPoint.options` gets answer options built only from the author's own diagnosis and differential diagnoses (the report says so). A stage without a question asks "What is the most likely diagnosis?".
- The server repeats every check when importing; the browser is never trusted.
- **Export JSON** downloads the same structured format, so a case can be exported, edited and imported again (with a new Case ID).

### Duplicate detection

Existing cases are **never overwritten or merged**.

- **Same Case ID** (ignoring capital letters): the import is refused. Change the `id` to import as a new case.
- **Possible duplicate** (similar title, same or similar diagnosis including aliases, similar clue text): shown with a similarity percentage, reasons and **View existing / Add anyway / Cancel**. Import is only possible after **Add anyway**.

Similarity = 35% title + 30% diagnosis + 35% clue text. A case is flagged at 60% overall, or with a near-identical title, or with clues at least 60% alike.

## Preview

Preview plays the **last saved draft** with the same game screens, lives, scoring, feedback and result screen as learners see. It runs on the staff member's page only: no attempt, score or history is stored, and learners can never see drafts.

## Accepted answers

Answers match a diagnosis when they are equal after ignoring capital letters, extra spaces, accents and punctuation, or equal to a configured alias or accepted answer. Similarity is **never** used to mark an answer correct. During play, correctness is decided on the server only, as before.

## Wrong-answer feedback in the game

When a case has wrong-answer explanations, the end-of-case review adds "About your wrong answers" for the options the learner actually chose. If no specific explanation matches, the existing general explanation is the feedback, exactly as before. Other new sections (clinical insight, reasoning, clue-by-clue explanations, investigations, differentials in detail) appear **after** the existing result sections and **only** when the author wrote them, so existing cases look exactly the same.

## Condition inventory and autocomplete

- Sources: a starter terminology list in [`data/conditions.json`](../data/conditions.json) (names, abbreviations, keywords, specialty, category; no clinical claims) plus every diagnosis, differential and wrong-answer condition already written in medical cases.
- Search covers name, alias, keyword, specialty and category; partial words; capital letters ignored; small typos tolerated (1 letter from 4 letters, 2 from 8). Example: `AIH` → Autoimmune hepatitis.
- Staff only. The learner game has no free-text answer box, so autocomplete cannot reveal an answer during play.

## Medical content safety

The Case Manager never invents medical content. Explanations, differentials, references and investigation results appear only if the author supplied them. Missing optional content stays empty.

## How data is stored (no new migration)

The Case Manager works with the two approved migrations already applied to the production database. Existing columns keep their meaning (`answer_label`, `final_explanation`, `key_clues`, `learning_points`, `differentials`, stages, options, references, published versions). The additional fields are stored in the existing `cases.domain_fields` JSON column under the key `authoring` (other keys in that column are never touched). See `src/features/admin/authoring-storage.ts`.

- Edit conflicts use the row's last-change time instead of a new revision column.
- "Unpublished changes" = the case changed after its last publication.

## Not built yet

- Spreadsheet **import** (CSV export of the inventory exists).
- Adding/editing conditions in the browser (needs a small `conditions` table).
- Audit log of admin actions (`audit_logs` in `supabase/proposed/`).
- Scoring from `startingScore` / `wrongAnswerPenalty` (stored, not yet used by the game, so scores do not change).
- Images and other media in stages.
