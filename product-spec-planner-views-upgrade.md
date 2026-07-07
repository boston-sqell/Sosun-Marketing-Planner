# Product Spec — Planner Views Upgrade (ClickUp-class features)

**Date:** 2026-07-02
**Source:** Competitive analysis of ClickUp (list, Gantt, workload, AI agents) and MeisterTask (kanban) screenshots + web research.
**Status:** Proposal

---

## 1. Where we stand

The good news: the planner engine (`backend/src/lib/planner/types.ts`) already has the data model these features need. Most of the gap is **UI, not schema**.

| Screenshot feature | Data model support today | UI today |
|---|---|---|
| Subtasks / nesting | ✅ `WorkItem.parentId` | ❌ not rendered in list |
| Dependencies | ✅ `dependsOn` / `blocks` + `dependenciesDone` validator | ❌ nowhere visible |
| Start/due dates | ✅ `startDate` / `dueDate` | partial (list column) |
| Priority flags | ✅ `priority` | ✅ pills |
| Labels / team chips | ✅ `labels` | ❌ not rendered |
| Multi-assignee avatars | ✅ `assigneeUids[]` | partial (names, no avatars) |
| Status groups w/ counts | ✅ `WorkflowStatus.category` | ❌ flat list |
| Kanban | ✅ transitions | ✅ basic (native HTML5 DnD) |
| Gantt / timeline | ✅ dates + dependencies | ❌ |
| Workload dashboard | ✅ `assigneeUids` + `category` | ❌ |
| Multiple saved views | ❌ needs `savedViews` collection | ❌ |
| AI agent teammate | ✅ automations engine (triggers/actions) | ❌ needs agent runner |

**Blocker to note first:** the absorption migration is committed (8cd3ca4) but **not run and not deployed**. Everything below assumes work items live in `workItems` — run the migration before building on it.

---

## 2. Phases

### Phase 1 — Grouped list view with subtasks (highest impact / effort ~3–4 days)

ClickUp's core list UX: collapsible status groups, nested subtasks, inline add.

- Group `Planner.tsx` rows by status (ordered by the workflow's `statuses` array), each group header = colored status pill + count + collapse chevron. Collapse state in `localStorage`.
- Render subtasks (`parentId`) indented beneath parents with an expand toggle and a subtask-count badge (`⌗ 2` like the screenshots). Fetch is already flat — build a parent→children index client-side.
- "+ Add task" row at the bottom of each group → `POST /api/planner/items` with that group's status as `initialStatus` override (engine change: allow staff to create directly into a non-initial status *or* create then auto-fire transitions; simpler: create at initial status and show it in its true group).
- Columns: assignee avatar stack (initials circles from `UserItem.displayName`), priority flag (existing colors), label chips, due date (red when overdue — reuse dashboard logic).
- No new dependencies. Inline styles + CSS vars per house style.

### Phase 2 — Kanban upgrade with dnd-kit (effort ~2–3 days)

`PlannerBoard.tsx` currently uses native HTML5 drag events — no keyboard access, janky on touch/PWA.

- Replace with **@dnd-kit** (~10 kb, keyboard + screen-reader accessible, works with React 19).
- Transition-aware drops: on drag start, call `GET /items/:id/transitions` (or precompute from cached workflow) and dim columns the actor cannot legally move to — the engine's conditions/validators stay the single source of truth.
- Card face: labels, due-date chip, checklist progress, avatar stack (MeisterTask style).
- Optional: WIP count per column header.

### Phase 3 — Timeline / Gantt view (effort ~4–6 days)

- New tab in `PlannerViewTabs`: **Timeline** (`/planner/timeline`).
- Library: **SVAR React Gantt** (MIT, React-native, TypeScript, drag-to-reschedule, dependency links, auto-shift of dependents) — the only MIT option that's genuinely a React component. Fallback if bundle size offends: a custom CSS-grid week/month bar view (drag handles adjust `startDate`/`dueDate` via `PUT /items/:id`), deferring dependency arrows.
- Bars colored by status category; today-line; dependencies drawn from `dependsOn`.
- Drag commits: optimistic update → `PUT` → rollback on error (same pattern as board).
- Items without dates appear in an "unscheduled" tray, draggable onto the timeline.

### Phase 4 — Workload dashboard (effort ~2–3 days)

ClickUp's team view: per-assignee cards with completion ring + status breakdown.

- New page `/planner/workload` (staff-only via existing RBAC): one card per assignee + an **Unassigned** card.
- Each card: done vs. not-done counts, completion ring (SVG donut, no chart lib needed), collapsible status rows with counts, stacked bar of status colors.
- Group client-side over `plannerApi.listAll()` — one item can appear under multiple assignees (`assigneeUids[]`); that's correct (ClickUp does the same).
- Measure workload by task count first; the `fields` map can carry `estimateHours` later without schema change.
- Rebalance: drag a task card between assignee columns → `PUT` updates `assigneeUids`.

### Phase 5 — Saved views & view tabs (effort ~2 days)

The `+ View` pattern: per-space tab strip (List / Board / Timeline / Workload / custom filters).

- New Firestore collection `plannerViews/{viewId}`: `{ name, spaceId, kind: 'list'|'board'|'timeline'|'workload', filters: { status?, assignee?, label?, brand? }, sort, ownerUid, shared }`.
- Backend: CRUD under `/api/planner/views` (staff create; agency read shared only).
- Frontend: `PlannerViewTabs` becomes data-driven; a filter bar (reuse `TaskFilters.tsx` patterns) with "Save as view".

### Phase 6 — "Campaign Agent" AI teammate (effort ~1–2 weeks, ship last)

The screenshots show tasks assigned to an **Agent** with live "Prioritizing…" states (ClickUp Autopilot/Super Agents). Our version, scoped sanely:

- **Identity:** a pseudo-user (`role: 'internal'`, `uid: 'agent:campaign'`) so `assigneeUids` and avatars work unchanged.
- **Trigger:** the existing `Automation` engine — `itemCreated`/`statusEntered` triggers already support a `webhook` action; point it at a new backend route `/api/planner/agent/run` instead of inventing a new mechanism.
- **Runner:** backend job that loads the item + comments + linked campaign, calls the Claude API with a task-type-specific instruction (e.g. draft brief, summarize research, propose checklist), writes the result as a comment + optional field updates, then fires a transition (e.g. `agent_done`).
- **Status surface:** an `agentRuns/{runId}` doc (`queued|running|done|failed`) that the item detail view polls → renders the "Prioritizing…" style live badge.
- **Guardrails:** agent may comment and set fields; it may **not** approve (approval chains stay human), delete, or touch budget fields. All actions land in the existing activity audit.

---

## 3. Deliberately not copying

- **Chat channels per space** — Slack/WhatsApp already fill this; a half-good chat is worse than none.
- **Time tracking / points** — no current demand; `fields` can absorb it later.
- **Docs module** — Drive integration (`routes/drive.ts`) already covers documents.

## 4. Cross-cutting rules

- Every new view must respect `agencyCanAccess()` filtering — workload and timeline are staff-lens features; gate them like the audit views.
- Firestore economics: all views reuse the single `listAll()` fetch + client-side indexing; no new per-view queries until item counts justify cursors.
- House style: inline styles + CSS variables, lucide-react icons, no Tailwind.
- New deps total: `@dnd-kit/core` + `@dnd-kit/sortable` (Phase 2), `wx-react-gantt` (SVAR, Phase 3). Nothing else.

## 5. Suggested order & rough total

1 → 2 → 4 → 3 → 5 → 6. Phases 1+2+4 (~2 weeks) deliver most of the perceived "ClickUp feel" for the least effort; Gantt and the agent are the showpieces after.

## 6. References

- SVAR React Gantt (MIT): https://github.com/svar-widgets/react-gantt · comparison: https://svar.dev/blog/top-react-gantt-charts/
- DHTMLX Gantt CE (fallback): https://github.com/DHTMLX/gantt
- dnd-kit: https://dndkit.com/react/quickstart/
- Workload view patterns (Asana): https://asana.com/features/resource-management/workload
- ClickUp Autopilot Agents: https://help.clickup.com/hc/en-us/articles/37045015737111-What-are-Autopilot-Agents
