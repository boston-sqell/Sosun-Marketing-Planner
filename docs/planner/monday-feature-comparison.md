# Planner vs. monday.com — feature comparison & adoption notes

**Date:** 2026-07-03
**Source:** Live walkthrough of `sqrll.monday.com/boards/5029657783` ("marketing task" board, Main table + Kanban views, Automations library, Agents, Dashboard/reporting page) + direct read of the current planner source (`frontend/src/pages/Planner*.tsx`, `backend/src/lib/planner/*`, `backend/src/routes/planner/*`).
**Supersedes (status column only):** `product-spec-planner-views-upgrade.md` — see §0.

---

## 0. Correction to the existing spec doc first

`product-spec-planner-views-upgrade.md` (dated 2026-07-02, status "Proposal") marks Timeline, Workload, Saved views, and the Campaign Agent as ❌ not built. That's no longer true. Reading the actual working tree today:

| Spec phase | Spec's claimed status | Actual status found in repo |
|---|---|---|
| Phase 1 — grouped list + subtasks | ❌ | ✅ `Planner.tsx` groups by status, collapses (`localStorage`), renders `parentId` children indented, tracks labels |
| Phase 2 — Kanban w/ dnd-kit | native HTML5 | ✅ `PlannerBoard.tsx` present; `@dnd-kit` also used in Workload's drag-to-reassign |
| Phase 3 — Timeline/Gantt | ❌ | ✅ `PlannerTimeline.tsx` (814 lines) — custom SVG bars, bezier dependency curves, unscheduled tray |
| Phase 4 — Workload | ❌ | ✅ `PlannerWorkload.tsx` (625 lines) — dnd-kit drag between assignee cards |
| Phase 5 — Saved views | ❌ needs `plannerViews` | ✅ `backend/src/routes/planner/views.ts` (untracked) + `PlannerViewTabs.tsx` (untracked) — full CRUD, staff-create/agency-shared-read |
| Phase 6 — Campaign Agent | needs agent runner | ✅ `backend/src/routes/planner/agent.ts` (untracked) — webhook-gated runner, Claude API call w/ mock fallback, writes comment + checklist inside a locked-aware transaction, fires `agent_done` transition |

**Why the mismatch:** this work exists in the working tree but is **uncommitted** — `git status` shows it as modified/untracked on branch `planner-engine-phase1`, layered on top of commit `8c589b9`. Someone (a prior session, most likely) executed the whole spec after the doc was written and never updated the doc's status table or committed. Nothing here is deployed; per [[sosun-planner-stack]] the absorption migration itself (`8cd3ca4`) is committed but not run, so none of this — spec-native or monday-inspired — should ship before that migration runs (see `docs/planner/absorption-runbook.md`).

**Action:** update the spec doc's status column to ✅ across the board, or delete it in favor of this file — keeping both around invites the next session to repeat this same confusion.

---

## 1. What the monday board actually has

Board: single "marketing task" board, two views (Main table, Kanban), 3 seed rows, 2 groups (To-Do / Completed, colored, collapsible).

**Columns:** Task (name), Owner (person), Status (label picker: Working on it/Done/Stuck/Not Started, colored, with a leading state icon — warning/check/clock), Due date (strikethrough once done), Budget (currency), Files, Last updated (auto, actor + relative time), **Timeline** (a date-*range* pill, distinct from Due date — `Jul 2 - 3`), Priority (Low/High/Medium, colored), Notes (label picker: Action items/Meeting notes/Other).

**View types on offer** (from the "+ Add view" menu — not all built on this board): Table, Gantt, Chart, Calendar, Kanban, Doc, File gallery, Form, Dashboard. Plus an AI page-builder ("Build with Vibe") and an Apps marketplace tab.

**Automations** (`Automate` menu): trigger → condition → action recipe library, categorized (AI-powered / 2-way sync / Recommended / Productivity / Dates / Communication / Sync / Connected & mirror columns). Representative recipes: status→move group, status→notify, item created→assign creator as person, date arrives→notify, email received→create item, **date/time period→create an item** (recurring task generation), column changes→notify. 53 third-party integrations listed (Gmail, Outlook, Slack, Google Calendar shown inline).

**AI-powered automations** (separate sub-category, notable): "When X is created/changed, use AI to fill in column" — triggers are item created, update created, subitem created, item name changes, column changes, activity/email created; the action is always "AI writes a value into an arbitrary column." This is more granular than a single agent — it's per-column, per-trigger AI writes.

**Agents** (top-nav item, separate from Automate): a general-purpose agent builder — "Connect your tools, track what matters, and let agents work proactively on your behalf." Broader than one fixed persona.

**Dashboard/reporting:** a separate page, not a board view — pulls from "1 connected board," widgets added ad hoc: 4 KPI counters (All Tasks / In progress / Stuck / Done, each with its own filter), a pie chart ("Tasks by status"), a bar chart ("Tasks by owner"). Exportable, filterable by People.

---

## 2. Gap analysis — what's genuinely new vs. what our planner already covers

| monday feature | Already covered by planner (as-built, uncommitted)? | Verdict |
|---|---|---|
| Grouped/collapsible list, subtasks, labels | Yes — Phase 1 | No work needed |
| Kanban with status columns + counts | Yes — Phase 2 | No work needed |
| Gantt/Timeline with dependency lines | Yes — Phase 3 (custom SVG, no library dep) | No work needed |
| Per-assignee workload view | Yes — Phase 4 | No work needed |
| Saved/custom views per space | Yes — Phase 5 | No work needed |
| Single AI teammate on tasks | Yes — Phase 6 (`agent.ts`) | Narrower than monday's per-column AI, see below |
| Timeline as a *date-range column* (vs. single due date) | Partial — `WorkItem` has both `startDate` and `dueDate`, so the data model already supports it; Timeline view renders it as a bar. The *list/table* view (`Planner.tsx`) only surfaces `dueDate` today, not the range as an inline chip. | **Small gap:** render a `Jul 2 – 3` range chip in the list view using existing `startDate`/`dueDate`, no schema change. |
| Recurring item creation ("every time period create an item") | No — `AutomationTrigger` only has `statusEntered` \| `itemCreated`. No time-based trigger exists anywhere in `automations.ts`/`types.ts`. | **Real gap.** Needed for recurring campaign tasks (weekly reporting, monthly content calendar seeds). |
| Per-column AI autofill (item created/updated/subitem/name-changed/activity → AI writes a specific column) | No — `agent.ts` is a single fixed job: comment + checklist + one terminal transition. It can't be pointed at an arbitrary field. | **Real gap, but scope carefully** — see §3. |
| Standalone "build your own agent" (freeform, tool-connected, proactive) | No — `SYSTEM_ACTOR` is hardcoded to `agent:campaign`; one prompt, one behavior. | **Skip.** This is monday selling a general agent platform; a marketing planner doesn't need a bring-your-own-agent builder. Matches the existing spec's §3 "deliberately not copying" judgment call for chat channels — same logic applies here. |
| Cross-board KPI dashboard (counters + pie + bar, filterable, exportable) | No — Workload is per-assignee cards, not a KPI/chart rollup. `Reports.tsx` exists in the app but is a separate legacy page, not planner-native. | **Real gap**, and probably the single highest-value monday feature to clone — see §3. |
| Calendar view (item dates plotted on a month grid) | No, planner-native — `CalendarView.tsx` exists but is the legacy events/tasks calendar, not wired to `workItems`/`plannerApi`. | **Medium gap** — likely straightforward once absorption ships, since it's the same `startDate`/`dueDate` data Timeline already reads. |
| Form view (external-facing intake form → creates item) | No | **Skip for now** — no stated use case (no external client intake mentioned); flag as future if agency partners need self-serve request submission. |
| File gallery view | No | **Skip** — Files already exist as a column/attachment; a dedicated gallery view is low value for a 3-10 person team. |
| 2-way calendar/email sync, Slack/Gmail/Outlook integrations | No | **Out of scope** — matches spec §3's existing "chat channels" exclusion; Slack/Gmail integration is a distinct, much larger project (OAuth, webhook infra) and nothing in the current ask suggests it's needed yet. |

---

## 3. Recommended additions (only the real gaps, sized)

### 3a. Timeline range chip in list view — effort: trivial (~1 hr)
Render `startDate`–`dueDate` as a single pill in `Planner.tsx`'s list rows when both are set (falls back to today's single due-date chip when only one is present). Pure UI, existing fields, no backend change.

### 3b. Time-based automation trigger ("recurring item") — effort: ~1 day
- Add `{ type: 'timePeriod'; cron?: string; intervalDays?: number; templateId: string }` to `AutomationTrigger` in `types.ts`.
- Needs a scheduler tick (the repo already runs a Cloud Scheduler job per [[sosun-planner-stack]]/`deploy-scheduler.bat` conventions) that evaluates time-based automations and calls `createWorkItems` from a template — same post-function that already exists for manual "spawn subtasks."
- Matches the existing spec's Phase 6 delivery pattern (webhook-triggered background job) so no new architecture, just a new trigger source.

### 3c. Per-field AI autofill action — effort: ~2-3 days, narrower than monday's version
Don't build monday's fully general "AI fills any column on any trigger" system — that's a lot of surface area for uncertain payoff. Instead extend the *existing* automation engine:
- Add one new `AutomationAction`: `{ type: 'aiSetField'; fieldId: string; instruction: string }`.
- Reuse `agent.ts`'s Claude-call-with-mock-fallback pattern (same API key, same locked-transaction write pattern) but write to `fields[fieldId]` instead of always appending a comment.
- This lets staff wire "when item created in type=social-post, AI-fill `fields.hookAngle`" without inventing a new runner — it's the same trigger→action pipeline `automations.ts` already evaluates, just one more action variant.

### 3d. KPI/chart dashboard — effort: ~3-4 days, highest value
This is the one monday feature with no planner analogue at all today.
- New page `/planner/dashboard` (staff-only, same RBAC gate as Workload).
- Reuse the single `plannerApi.listAll()` fetch (per spec's Firestore-economics rule — no new queries).
- Widgets: counter cards (total / by status category, each independently filterable by workflow/space/assignee — mirrors the monday counters), a status-breakdown donut (SVG, same no-chart-lib approach Workload already uses for its completion ring), and a by-assignee bar chart (reuse Workload's per-assignee grouping logic, just render as bars instead of cards).
- Skip "connected board" multi-board aggregation — this planner is single-space per view already; cross-space rollup can wait for a real ask.
- Export: reuse whatever CSV/export utility (if any) exists elsewhere in the app before writing a new one — check `Reports.tsx`/`Budget.tsx` first.

### 3e. Planner-native calendar view — effort: ~2 days
- New page `/planner/calendar`, month grid, items plotted by `dueDate` (fallback `startDate`).
- This is largely "point the existing `CalendarView.tsx` rendering logic at `plannerApi` instead of the legacy tasks/events collections" — check whether `CalendarView.tsx`'s grid component can be extracted/reused before writing a new grid from scratch.

**Suggested order:** 3a → 3d → 3b → 3e → 3c. The chart dashboard (3d) is the one feature monday has that we have nothing like; the AI-autofill (3c) is the most speculative value and should wait for a concrete use case.

---

## 4. Blockers (unchanged, repeating so this doc stands alone)

Nothing in §3 should be built against production data paths until the absorption migration actually runs and deploys — see `docs/planner/absorption-runbook.md` and [[sosun-planner-stack]]. All of Phases 1-6 above are sitting uncommitted on `planner-engine-phase1`; committing and running the migration is the prerequisite for shipping any of this, monday-inspired or not.
