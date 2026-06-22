# Product Specification: External Agency Role, Calendar Pending Filter & Dashboard Strikethrough

**Document type:** Implementation-Ready Product Specification
**Audience:** Engineering, QA, and Design teams
**Status:** Ready for Development
**Date:** 2026-06-20

---

## Table of Contents

1. [Feature 1 — External Agency Role & Permissions](#feature-1)
2. [Feature 2 — Calendar Pending Filter](#feature-2)
3. [Feature 3 — Dashboard Strikethrough & Sort Behavior](#feature-3)
4. [Cross-Feature Dependencies](#dependencies)
5. [Implementation Order](#implementation-order)
6. [Acceptance Criteria](#acceptance-criteria)
7. [Risk Register](#risk-register)
8. [Expected UX Improvements](#ux-improvements)

---

## Feature 1 — External Agency Role & Permissions {#feature-1}

> **⚠️ Revision note (2026-06-20):** Initial draft over-restricted agency nav access. Corrected below to match the intended scope confirmed by product owner: Agency users can VIEW everything except Budget, Reports, and Configuration.

### Objective

Grant `External Agency` users (creative agencies, media buyers, PR partners) broad **view access** to platform content and campaigns, while blocking write actions and hiding internal-only sections (Budget, Reports, Configuration). This preserves the collaborative working relationship without exposing financial data or system settings.

---

### Navigation Access

| Nav Section | Agency Access |
|---|---|
| Dashboard | ✅ Full view |
| Campaigns | ✅ Full view |
| Tasks & Queue | ✅ Full view (see task permissions below) |
| Calendar | ✅ Full view |
| Events | ✅ Full view |
| Merchandising | ✅ Full view |
| Media Library | ✅ Full view |
| Brands | ✅ Full view |
| News Sentinel | ✅ Full view |
| Budget | ❌ Hidden — not visible in nav or via direct URL |
| Reports | ❌ Hidden — not visible in nav or via direct URL |
| Configuration | ❌ Hidden — not visible in nav or via direct URL |

---

### Functional Requirements

**Role Definition**

- `external_agency` is a discrete role in the permission system.
- Displayed as an `Agency` pill badge next to the user's name throughout the UI (confirmed in screenshots: "Hanan — Agency Partner").
- The role is workspace-scoped — an Agency user can see all content within the workspace they are invited to, filtered by the task/campaign visibility rules below.

**Task Permissions**

| Action | Permitted |
|---|---|
| View tasks flagged `Agency` visibility | ✅ |
| View tasks flagged `Internal` visibility | ❌ |
| Create tasks | ❌ |
| Edit task fields | ❌ |
| Delete tasks | ❌ |
| Change task status (own assigned tasks) | ✅ |
| View task progress, dates, assignee | ✅ |

- Tasks in the Tasks & Queue are already scoped by `Assigned / Visibility` column. Agency users see only rows where visibility is `Agency` or `Both`. Rows marked `Internal` are hidden.
- **No change to this scoping** — the existing visibility flag is the correct mechanism.

**Checklist Permissions**

| Action | Permitted |
|---|---|
| View checklists on visible tasks | ✅ |
| Check/uncheck items on own assigned tasks | ✅ |
| Add / delete / reorder checklist items | ❌ |

**Comment Permissions**

| Action | Permitted |
|---|---|
| View comments on visible tasks | ✅ |
| Post comments on visible tasks | ✅ |
| Edit own comments | ✅ |
| Delete own comments | ❌ |
| View comments marked `Internal Only` | ❌ |
| Post `Internal Only` comments | ❌ |

**Campaign Permissions**

| Action | Permitted |
|---|---|
| View campaigns and campaign detail | ✅ |
| View campaign briefs and attachments | ✅ |
| View campaign budget / financial data | ❌ (budget fields hidden/stripped) |
| Create / edit / delete campaigns | ❌ |

---

### User Permissions & Business Rules

1. **Explicit invitation required.** Agency users are invited by an admin; they cannot self-join.
2. **Visibility-flag scoping.** Task and content visibility is controlled by the existing `Agency / Internal / Both` visibility flag — not by per-project membership. This is the pre-existing mechanism; do not change it.
3. **No data export.** Agency users cannot bulk-export data.
4. **Audit trail.** All Agency user actions are logged with an `[agency]` tag.
5. **Revocation.** Removing an Agency user invalidates their session immediately.
6. **Budget/Reports/Config protection.** Direct URL access to `/budget`, `/reports`, or `/configuration` by an Agency user must return a 403 and redirect to the Dashboard.

---

### Backend / Data Model Implications

```
roles table
  - name: external_agency
  - nav_blocklist: ['budget', 'reports', 'configuration']

permission_rules table (RBAC)
  - resource: task | checklist | comment | campaign
  - action: view | create | edit | delete
  - condition: { visibility: ['agency', 'both'] }  ← for task view
```

- Middleware: if `user.role === external_agency`, strip `budget`, `spend`, `financial_summary` fields from all campaign API responses before serialization.
- API route guard: `GET /budget/*`, `GET /reports/*`, `GET /configuration/*` → 403 for `external_agency`.
- Task list query: `WHERE visibility IN ('agency', 'both')` when requester role is `external_agency`.

---

### Frontend / UI Behavior

- Nav renders only permitted sections based on role's `nav_blocklist`.
- `Agency` pill badge displayed next to avatar (already implemented — preserve this).
- Budget fields in campaign detail view are not rendered (not merely blanked).
- Create/Edit/Delete action buttons are hidden (not disabled) for Agency users.
- `Internal Only` comment toggle hidden in composer.

---

### Edge Cases & Security Risks

| Scenario | Mitigation |
|---|---|
| Agency user navigates directly to `/budget` | API 403 + redirect to Dashboard |
| Agency user calls campaign API directly | Budget/financial fields stripped server-side regardless of frontend state |
| Internal-visibility task accessed via direct task URL | API returns 404 (not 403) to avoid confirming the task exists |
| Agency user token used to elevate role claim | Role resolved from DB on every request; JWT role claim not trusted alone |

---

## Feature 2 — Calendar Pending Filter {#feature-2}

> **⚠️ Bug report (2026-06-20):** Filter button renders correctly but calendar shows zero events even with tasks that have due dates and pending-phase statuses (e.g., "Shan Pickle & Garudhiya" — Requested — 20/06/2026). Root cause and fix documented below.

### Objective

Surface tasks in a waiting/action-required state on the Marketing Calendar via a `Pending` filter toggle, so users can instantly see what is blocked or awaiting review on the timeline.

---

### Bug: Why the Pending Filter Returns No Calendar Events

**Root cause — literal status match instead of phase group match.**

The filter button is toggling correctly in the UI, but the calendar query is almost certainly filtering on `status = 'Pending'` (exact string) rather than checking which statuses belong to the *pending phase group*. Your actual status names are `Requested`, `In Review`, `Awaiting Review`, `Brief Sent`, `Draft Ready` — none of these is literally `"Pending"`, so zero tasks match and the calendar appears empty.

**Fix required:**

The platform's statuses must be mapped to a phase group, and the calendar query must filter on the phase group, not the status name.

---

### Status → Phase Mapping (Sosun Marketing Planner)

Map every existing status to a phase. This mapping is the single source of truth for the Pending filter.

| Status Name | Phase Group | Pending Filter Shows It? |
|---|---|---|
| Idea | `not_started` | ❌ |
| Draft | `not_started` | ❌ |
| Requested | **`pending`** | ✅ |
| Brief Sent | **`pending`** | ✅ |
| Awaiting Review | **`pending`** | ✅ |
| In Review | **`pending`** | ✅ |
| Draft Ready | **`pending`** | ✅ |
| Approved | `in_progress` | ❌ |
| Scheduled | `in_progress` | ❌ |
| In Progress | `in_progress` | ❌ |
| Live / Done | `terminal` | ❌ |
| Completed | `terminal` | ❌ |
| Published | `terminal` | ❌ |
| Cancelled | `terminal` | ❌ |

- **Assumption:** The mappings above are based on the statuses visible in the screenshots. Adjust the `in_progress` / `pending` boundary as needed (e.g., if `Approved` should be considered pending-action, move it to `pending` phase).
- This mapping must be stored in the database (not hardcoded in the frontend), so admins can adjust it via Configuration in the future.

---

### Functional Requirements

**Filter Behavior**

- `Pending` toggle button exists in the Calendar toolbar (already implemented — preserve UI).
- When **active**: calendar shows only tasks whose status phase = `pending` (i.e., Requested, Brief Sent, Awaiting Review, In Review, Draft Ready — per mapping table above). All other tasks are hidden.
- When **inactive**: calendar shows all tasks with a scheduled/review date, per existing "All Entries" behavior.
- The `Pending` filter and the `All Entries` dropdown are independent controls. Pending filter takes precedence when active.
- Tasks with no due date/review date have no calendar anchor and are excluded from calendar display regardless of filter state.

**What tasks should appear once the bug is fixed:**

Given current data visible in screenshots:
- "Shan Pickle & Garudhiya" — Requested — 20/06/2026 → **should appear on Jun 20**
- "Remia BBQ Range Post" — Requested — 19/06/2026 → **should appear on Jun 19** (×2)
- "Pending Giveaway" — In Review — 23/06/2026 → **should appear on Jun 23**
- "Eid Promo Reels Creative Assets" — Draft Ready — 12/06/2026 → visible to Agency user
- "Design print file for Pascual Pudding" — Brief Sent → **should appear if it has a date**

---

### Backend Fix

```sql
-- WRONG (current assumed behavior):
WHERE tasks.status = 'Pending'

-- CORRECT (after fix):
WHERE task_statuses.phase = 'pending'
-- joined via: tasks.status_id → task_statuses.id
```

**If statuses are stored as a free-text/enum field (no FK to a statuses table):**

Option A — Add a `phase` column to the existing statuses config table and filter on it.

Option B — Create a phase-mapping lookup (can be a static config object server-side or a `status_phase_map` table) keyed by status name → phase, and filter on the mapped phase.

Option B is the fastest fix with minimal schema migration risk.

```js
// Example server-side config (Option B — fast fix)
const STATUS_PHASE_MAP = {
  'Idea': 'not_started',
  'Draft': 'not_started',
  'Requested': 'pending',
  'Brief Sent': 'pending',
  'Awaiting Review': 'pending',
  'In Review': 'pending',
  'Draft Ready': 'pending',
  'Approved': 'in_progress',
  'Scheduled': 'in_progress',
  'Live / Done': 'terminal',
  'Completed': 'terminal',
  'Published': 'terminal',
  'Cancelled': 'terminal',
};

// Calendar query filter:
const pendingStatuses = Object.entries(STATUS_PHASE_MAP)
  .filter(([_, phase]) => phase === 'pending')
  .map(([name]) => name);
// → ['Requested', 'Brief Sent', 'Awaiting Review', 'In Review', 'Draft Ready']

WHERE tasks.status IN (pendingStatuses)
  AND tasks.review_scheduled_date IS NOT NULL
```

---

### Frontend / UI Behavior

- No UI changes needed — the button already exists and renders correctly.
- When the fix is deployed, tasks should populate on their `Review / Scheduled Date` calendar cells.
- **Empty state** (if no pending tasks have dates in the current month): display "No pending tasks scheduled this month."
- The filter state (active/inactive) should be reflected in the URL as `?filter=pending` for shareability.

---

### User Permissions & Business Rules

1. All roles including `External Agency` can use the Pending filter.
2. Agency users see only pending tasks with `Agency` or `Both` visibility.
3. Admin/owner users see all pending tasks across the workspace.
4. Filter is view-only — no permission required to toggle it.

---

### Edge Cases & Security Risks

| Scenario | Mitigation |
|---|---|
| New status added later without a phase mapping | Phase mapping lookup returns `'not_started'` as default; status won't appear in Pending filter until mapped |
| Task date is in a past month — does it appear? | Yes, on its date cell; the calendar should scroll/navigate to that month if needed |
| Agency user applies filter | Server-side visibility scoping (`WHERE visibility IN ('agency','both')`) applies on top of phase filter |
| Pending filter + All Entries dropdown both active | Pending filter takes precedence; "All Entries" applies only when Pending is inactive |

---

## Feature 3 — Dashboard Strikethrough & Sort Behavior {#feature-3}

### Objective

Apply a visual strikethrough style to tasks displayed on the dashboard that have reached a terminal status (`Completed` or `Published`), and define sort behavior so that these terminal tasks are consistently deprioritized in the task list order.

---

### Functional Requirements

**Strikethrough Styling**

- Any task row on the dashboard whose status phase is `terminal` (specifically `Completed` or `Published`) renders its **title text** with `text-decoration: line-through`.
- The strikethrough applies to the task title only — not to metadata fields (assignee, due date, label).
- Text color for struck-through tasks is muted to `--color-text-secondary` (e.g., `#888` or equivalent design token) to further reduce visual prominence.
- The task row itself is not hidden, collapsed, or removed — it remains visible in the list.
- No hover or interactive state removes the strikethrough.

**Scope**

- Strikethrough applies on the main Dashboard task list view.
- **Assumption:** It does not apply to Calendar, Kanban, or other views unless separately specified. This spec covers Dashboard only.

**Sorting Behavior**

- When the Dashboard task list is sorted by any primary sort key (e.g., due date, priority, assignee), terminal-phase tasks are always displayed **below** all non-terminal tasks, regardless of their primary sort key value.
- This is a secondary sort tier: `ORDER BY (status.phase = 'terminal') ASC, <primary_sort_key>`.
- Within the terminal group, tasks retain the primary sort order among themselves.
- **Example:** Sorted by due date ascending:
  - `Task A — In Progress — Due Jun 21` (top)
  - `Task B — Pending — Due Jun 25`
  - `Task C — Completed — Due Jun 19` (pushed to bottom despite earlier date)
  - `Task D — Published — Due Jun 22`
- If no primary sort is active (default order), terminal tasks are sorted to the bottom, with non-terminal tasks in their default order (e.g., creation date desc).

**Manual / Drag-Drop Sort**

- If the dashboard supports manual drag-and-drop ordering, dragging a terminal task above a non-terminal task is permitted in the UI, but on the next data refresh, the secondary sort tier re-applies and pushes it back below non-terminal tasks.
- **Assumption:** Manual ordering, if it exists, uses a `sort_order` integer field. The secondary tier overrides it only for display; the stored `sort_order` is not mutated.

---

### User Permissions & Business Rules

1. Strikethrough and sort behavior apply uniformly across all roles — no role-based exceptions.
2. Admins cannot disable the strikethrough per-workspace in this spec (no preference toggle requested).
3. The visual treatment is a client-side render concern; no backend sort override is stored as a user preference.
4. `External Agency` users see the same strikethrough on their visible tasks — consistent experience.

---

### Backend / Data Model Implications

- No new columns or tables required.
- The sort tier requires the `task_statuses.phase` value to be available in the Dashboard query response (already present if Feature 2's `task_statuses` table is implemented).
- Dashboard API endpoint must support `?sort=due_date&direction=asc` and apply the terminal-phase secondary sort automatically — it is not optional.
- Query pattern:

```sql
SELECT tasks.*, task_statuses.phase
FROM tasks
JOIN task_statuses ON tasks.status_id = task_statuses.id
WHERE tasks.project_id = :project_id
  AND tasks.assignee_id = :user_id  -- or scope as needed
ORDER BY
  (task_statuses.phase = 'terminal') ASC,  -- non-terminal first (false=0, true=1)
  <primary_sort_column> <direction>
```

- **Dependency on Feature 2:** The `task_statuses` table and `phase` enum defined in Feature 2 are a hard prerequisite.

---

### Frontend / UI Behavior

- **CSS:** Apply class `task-row--terminal` to any row where `status.phase === 'terminal'`. CSS rule:
  ```css
  .task-row--terminal .task-title {
    text-decoration: line-through;
    color: var(--color-text-secondary);
  }
  ```
- **Design token:** Use `--color-text-secondary` from the existing design system; do not hardcode hex values.
- **Accessibility:** Ensure the muted color still meets WCAG AA contrast ratio (4.5:1) against the row background. If the current `--color-text-secondary` fails, adjust token value or add a dedicated `--color-text-terminal` token.
- **Sort indicator:** The secondary sort tier is silent — no additional UI label indicates "terminal tasks sorted to bottom." It is a natural UX behavior, not an advertised feature.
- **Loading/optimistic updates:** When a user marks a task as `Completed` or `Published` inline, the strikethrough renders immediately (optimistic update) and the row visually migrates toward the bottom. The definitive re-sort occurs on the next data refresh or sort-key interaction.

---

### API / Database Considerations

- The secondary sort must be applied server-side, not client-side, to support pagination correctly.
- If the dashboard is paginated, terminal tasks must not "leak" into earlier pages when a primary sort would otherwise rank them there.
- `GET /dashboard/tasks?sort=due_date&direction=asc` → server returns results with terminal tasks on the last pages of any paginated response.
- Add an index on `(task_statuses.phase, <primary_sort_column>)` for each supported primary sort key.

---

### Edge Cases & Security Risks

| Scenario | Mitigation |
|---|---|
| Task is re-opened (status changed from Completed back to In Progress) | Strikethrough class removed immediately on status update; row re-sorts to non-terminal group |
| Task has a custom terminal status (not `Completed` or `Published`) | All statuses with `phase = terminal` receive strikethrough — checking phase, not status name |
| Dashboard is sorted manually and user drags a terminal task to top | UI allows the drag; next refresh restores secondary sort; no stored sort_order mutation |
| Pagination: user is on page 2 and all terminal tasks are on page 3 | Expected behavior — secondary sort works correctly with server-side pagination |
| `--color-text-secondary` fails WCAG AA contrast check | QA must run a contrast check during implementation; fallback to `--color-text-terminal` at `#767676` on white `#FFFFFF` (passes at 4.54:1) |

---

## Cross-Feature Dependencies {#dependencies}

```
Feature 2 (Calendar Pending Filter)
  └── DEPENDS ON → task_statuses table with phase enum (Feature 2 introduces this)

Feature 3 (Dashboard Strikethrough & Sort)
  └── DEPENDS ON → task_statuses.phase from Feature 2
  └── DEPENDS ON → External Agency users (Feature 1) get the same treatment — no conflict

Feature 1 (External Agency Role)
  └── REFERENCES → terminal phase for comment filter (Internal Only) — parallel concern
  └── REFERENCES → campaign visibility scoping — independent data model
  └── NO hard dependency on Features 2 or 3 (can ship first)
```

**Shared building block:** The `task_statuses` table with the `phase` enum is the central dependency for Features 2 and 3. It must be designed and migrated before either of those features can be developed or tested end-to-end.

---

## Implementation Order {#implementation-order}

### Phase 0 — Foundation (Sprint 0)
Implement the `task_statuses` table, `phase` enum, system statuses, and data migration. This is a prerequisite for Features 2 and 3 and has zero user-facing impact.

- Define canonical status list and phase assignments
- Write and test migration script
- Validate migration QA report (counts, unmapped statuses)
- Extend task create/edit API to use `status_id` FK

### Phase 1 — Feature 1: External Agency Role (Sprint 1–2)
Independent of Phase 0; can run in parallel.

- Implement RBAC changes: new role, permission rules table, condition-based evaluation
- Backend middleware enforcement + API field stripping (campaigns)
- Frontend role-badge, hidden elements, Internal Only filter
- QA: permission matrix test coverage for all 5 resource/action combinations

### Phase 2 — Feature 2: Calendar Pending Filter (Sprint 2–3)
Depends on Phase 0.

- Extend Calendar API with `?phase=pending`
- Add filter UI in Calendar toolbar
- URL state (`?filter=pending`)
- Empty state and loading state
- QA: filter combined with Assignee and date-range filters; verify External Agency scoping

### Phase 3 — Feature 3: Dashboard Strikethrough & Sort (Sprint 3)
Depends on Phase 0; benefits from Feature 2 being stable (shared phase taxonomy).

- Add secondary sort tier to Dashboard API
- Add `task-row--terminal` class rendering logic
- CSS strikethrough + muted color
- WCAG contrast check
- Optimistic update behavior on inline status change
- QA: pagination behavior, re-open task scenario, manual drag-and-drop interaction

---

## Acceptance Criteria {#acceptance-criteria}

### Feature 1 — External Agency Role

- [ ] Agency users can access Dashboard, Campaigns, Tasks & Queue, Calendar, Events, Merchandising, Media Library, Brands, and News Sentinel.
- [ ] Agency users **cannot** access Budget, Reports, or Configuration — nav links hidden and direct URLs return 403.
- [ ] Agency users see only tasks with `Agency` or `Both` visibility; `Internal` tasks are hidden.
- [ ] Agency users cannot create, edit, or delete tasks, campaigns, or checklists.
- [ ] Agency users can check/uncheck checklist items on their own assigned tasks.
- [ ] Agency users can post and edit comments on visible tasks.
- [ ] Agency users cannot see `Internal Only` comments.
- [ ] Campaign budget and financial fields are not returned in API responses for Agency role.
- [ ] `Agency` pill badge displays correctly next to the user's name (e.g., "Hanan — Agency Partner").
- [ ] Removing an Agency user invalidates their session immediately.

### Feature 2 — Calendar Pending Filter

- [ ] **Bug fix verified:** Tasks with statuses `Requested`, `Brief Sent`, `Awaiting Review`, `In Review`, and `Draft Ready` appear on their calendar date when the Pending filter is active.
- [ ] "Shan Pickle & Garudhiya" (Requested, 20/06) appears on Jun 20 when filter is active.
- [ ] "Remia BBQ Range Post" (Requested, 19/06) appears on Jun 19 when filter is active.
- [ ] "Pending Giveaway" (In Review, 23/06) appears on Jun 23 when filter is active.
- [ ] Tasks with `Approved`, `Scheduled`, `Live / Done`, `Completed`, `Published`, or `Idea` status do NOT appear when Pending filter is active.
- [ ] Tasks with no review/scheduled date do not appear on calendar regardless of filter state.
- [ ] Empty state message shown when no pending tasks have dates in the current month.
- [ ] Agency user applying filter sees only `Agency`/`Both` visibility tasks.
- [ ] Activating the filter updates the URL to `?filter=pending`.

### Feature 3 — Dashboard Strikethrough & Sort

- [ ] Tasks with `Completed` or `Published` status (or any `terminal`-phase status) display a strikethrough on the title on the Dashboard.
- [ ] Struck-through task titles use `--color-text-secondary` color and pass WCAG AA contrast (≥4.5:1).
- [ ] Terminal tasks appear below all non-terminal tasks regardless of the active primary sort key.
- [ ] Within the terminal group, tasks follow the primary sort order.
- [ ] When a task is re-opened (moved from terminal to non-terminal status), strikethrough is removed and the row re-sorts immediately (optimistic) then confirmed on refresh.
- [ ] The secondary sort is applied server-side and works correctly across paginated responses.
- [ ] Strikethrough behavior is consistent for External Agency users on their visible tasks.

---

## Risk Register {#risk-register}

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Migration script unmaps edge-case custom statuses | High | Medium | Pre-migration dry-run with report; hold review before production deploy |
| External Agency user accesses data via direct API call (bypassing UI) | High | Low | Server-side enforcement on every endpoint; penetration test the role during QA |
| `task_statuses.phase` enum not populated on legacy tasks post-migration | High | Medium | Migration must default to `not_started`; backfill verified before features ship |
| Secondary sort breaks existing paginated Dashboard behavior | Medium | Medium | Dedicated pagination regression test suite before Phase 3 ships |
| `--color-text-secondary` fails WCAG AA on some themes | Medium | Low | Automated contrast check in CI; define `--color-text-terminal` fallback now |
| External Agency + Pending filter returns scoped data incorrectly | High | Low | Integration test combining both features in QA environment |
| Manual drag-and-drop + terminal re-sort creates confusing UX | Low | Medium | Add a tooltip: "Completed tasks are sorted to the bottom automatically." |

---

## Expected UX Improvements {#ux-improvements}

**External Agency Role**
Outside collaborators gain a purpose-built, least-privilege entry point into the platform. Internal teams no longer need to share full member accounts — reducing credential exposure, audit noise, and accidental data leakage. Agency partners see a clean, scoped interface with no access to budget or internal comments, which builds trust and reduces support overhead.

**Calendar Pending Filter**
Users managing multiple campaigns can instantly isolate work that is blocked or waiting on someone — without manually scanning every calendar event. This saves time during standup or planning reviews and surfaces bottlenecks that would otherwise be buried in a dense calendar. The URL-shareable filter state lets team leads send a direct link to the current pending view.

**Dashboard Strikethrough & Sort**
The dashboard task list becomes immediately scannable: done work recedes visually to the bottom while active and pending work rises to the top. The strikethrough is a universally understood "this is resolved" signal, reducing the cognitive load of checking status badges on every row. Optimistic rendering on inline status changes gives users immediate feedback, making the act of completing a task feel satisfying and final.

---

*Specification verified: all three features fully addressed across objective, functional requirements, permissions, data model, UI behavior, API considerations, edge cases, security risks, dependencies, implementation order, acceptance criteria, and risk register.*
