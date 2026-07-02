/**
 * Absorption migration helpers (lib/planner/absorb.ts) — pure-function tests.
 * The migration script itself is I/O glue over these.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLegacyTaskWorkflow,
  campaignToWorkItem,
  eventToWorkItem,
  guessCategory,
  mapCampaignStatus,
  phaseToCategory,
  prune,
  slugify,
  upgradeLegacyTaskPatch,
  DEFAULT_LEGACY_STATUS,
  DEFAULT_SPACE_ID,
  LEGACY_STATUSES,
  LEGACY_TASK_WORKFLOW_ID,
} from '../lib/planner/absorb';
import { planTransition } from '../lib/planner/workflow';
import { WorkItem } from '../lib/planner/types';

const NOW = '2026-07-02T10:00:00.000Z';

describe('phaseToCategory / guessCategory', () => {
  it('maps the four legacy phases onto the three engine categories', () => {
    expect(phaseToCategory('not_started')).toBe('todo');
    expect(phaseToCategory('pending')).toBe('in_progress');
    expect(phaseToCategory('in_progress')).toBe('in_progress');
    expect(phaseToCategory('terminal')).toBe('done');
  });

  it('guesses sensible categories for statuses observed in the wild', () => {
    expect(guessCategory('Published to Insta')).toBe('done');
    expect(guessCategory('Confirmed')).toBe('in_progress');
    expect(guessCategory('Waiting on brief')).toBe('todo');
  });
});

describe('buildLegacyTaskWorkflow', () => {
  it('uses display names as status ids (no rewrite of live task.status)', () => {
    const wf = buildLegacyTaskWorkflow();
    expect(wf.id).toBe(LEGACY_TASK_WORKFLOW_ID);
    expect(wf.initialStatus).toBe(DEFAULT_LEGACY_STATUS);
    const ids = wf.statuses.map((s) => s.id);
    expect(ids).toContain('In Progress');
    expect(ids).toContain('To Do');
    expect(wf.statuses).toHaveLength(LEGACY_STATUSES.length);
    for (const s of wf.statuses) expect(s.id).toBe(s.name);
  });

  it('appends observed statuses, deduped case-insensitively', () => {
    const wf = buildLegacyTaskWorkflow(['in progress', 'Live Shoot', '  ', 'live shoot']);
    const ids = wf.statuses.map((s) => s.id);
    expect(ids.filter((i) => i.toLowerCase() === 'in progress')).toHaveLength(1);
    expect(ids).toContain('Live Shoot');
    expect(wf.statuses).toHaveLength(LEGACY_STATUSES.length + 1);
  });

  it('gives every status a role-gated Move transition from all other statuses', () => {
    const wf = buildLegacyTaskWorkflow();
    expect(wf.transitions).toHaveLength(wf.statuses.length);
    for (const t of wf.transitions) {
      expect(t.from).not.toContain(t.to);
      expect(t.from).toHaveLength(wf.statuses.length - 1);
      expect(t.conditions).toEqual([{ type: 'role', roles: ['admin', 'internal'] }]);
    }
  });

  it('produces a workflow the engine can actually run', () => {
    const wf = buildLegacyTaskWorkflow();
    const item: WorkItem = {
      id: 't1',
      typeId: 'task',
      workflowId: wf.id,
      title: 'Legacy task',
      spaceId: DEFAULT_SPACE_ID,
      status: 'In Progress',
    };
    const decision = planTransition(wf, item, 'move-to-completed', {
      actor: { uid: 'u1', roles: ['admin'] },
      facts: { now: NOW, subtaskStatuses: [], dependencyStatuses: [] },
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.patch.status).toBe('Completed');
  });
});

describe('upgradeLegacyTaskPatch', () => {
  const legacyTask = {
    title: 'Eid post',
    brand: 'Sosun Cola',
    status: 'In Progress',
    statusId: 'in-progress',
    statusPhase: 'in_progress',
    assignedTo: 'Aisha',
    draftDueDate: '2026-07-10',
    scheduledDate: '2026-07-14',
    createdAt: '2026-06-01T00:00:00.000Z',
  };

  it('returns null for docs that already carry a workflowId (idempotent)', () => {
    expect(upgradeLegacyTaskPatch({ ...legacyTask, workflowId: 'wf_task' }, NOW)).toBeNull();
  });

  it('backfills planner fields without touching status', () => {
    const patch = upgradeLegacyTaskPatch(legacyTask, NOW)!;
    expect(patch.status).toBeUndefined(); // never rewritten
    expect(patch.typeId).toBe('task');
    expect(patch.workflowId).toBe(LEGACY_TASK_WORKFLOW_ID);
    expect(patch.spaceId).toBe(DEFAULT_SPACE_ID);
    expect(patch.brandIds).toEqual(['Sosun Cola']);
    expect(patch.dueDate).toBe('2026-07-10'); // draftDueDate wins over scheduledDate
    expect(patch.locked).toBe(false);
    expect(patch.approval).toBeNull();
    expect(patch.absorbedAt).toBe(NOW);
  });

  it('maps meetings to the meeting type and defaults a missing status', () => {
    const patch = upgradeLegacyTaskPatch({ type: 'meeting' }, NOW)!;
    expect(patch.typeId).toBe('meeting');
    expect(patch.status).toBe(DEFAULT_LEGACY_STATUS);
  });

  it('resolves assignedTo display names to uids when known', () => {
    const nameToUid = new Map([['aisha', 'uid-aisha']]);
    const patch = upgradeLegacyTaskPatch(legacyTask, NOW, nameToUid)!;
    expect(patch.assigneeUids).toEqual(['uid-aisha']);
    const unknown = upgradeLegacyTaskPatch({ ...legacyTask, assignedTo: 'Nobody' }, NOW, nameToUid)!;
    expect(unknown.assigneeUids).toEqual([]);
  });

  it('never clobbers existing values', () => {
    const patch = upgradeLegacyTaskPatch(
      { ...legacyTask, spaceId: 'creative', brandIds: ['X'], dueDate: '2026-08-01' },
      NOW,
    )!;
    expect(patch.spaceId).toBe('creative');
    expect(patch.brandIds).toEqual(['X']);
    expect(patch.dueDate).toBe('2026-08-01');
  });

  it('marks terminal tasks completed and archived tasks archived', () => {
    const done = upgradeLegacyTaskPatch(
      { ...legacyTask, status: 'Published', statusId: 'published', statusPhase: 'terminal', publishedDate: '2026-06-20' },
      NOW,
    )!;
    expect(done.completedAt).toBe('2026-06-20');
    const archived = upgradeLegacyTaskPatch(
      { ...legacyTask, status: 'Archived', statusId: 'archived', statusPhase: 'terminal' },
      NOW,
    )!;
    expect(archived.archivedAt).toBe(NOW);
  });
});

describe('mapCampaignStatus / campaignToWorkItem', () => {
  it('maps legacy display statuses onto wf_campaign ids, defaulting to created', () => {
    expect(mapCampaignStatus('Planning')).toBe('planning');
    expect(mapCampaignStatus('Active')).toBe('inprogress');
    expect(mapCampaignStatus('Completed')).toBe('completed');
    expect(mapCampaignStatus('Cancelled')).toBe('archived');
    expect(mapCampaignStatus('???')).toBe('created');
    expect(mapCampaignStatus(undefined)).toBe('created');
  });

  it('copies a campaign into a planner-native work item', () => {
    const item = campaignToWorkItem(
      'c1',
      {
        name: 'Ramadan Push',
        brand: 'Sosun Cola',
        status: 'Active',
        startDate: '2026-06-01',
        endDate: '2026-07-15',
        objective: 'Awareness',
        budget: 50000,
        platforms: 'Instagram',
        postsPlanned: 12,
      },
      NOW,
    );
    expect(item.typeId).toBe('campaign');
    expect(item.workflowId).toBe('wf_campaign');
    expect(item.status).toBe('inprogress');
    expect(item.title).toBe('Ramadan Push');
    expect(item.brandIds).toEqual(['Sosun Cola']);
    expect(item.dueDate).toBe('2026-07-15');
    expect(item.migratedFrom).toBe('campaigns/c1');
    // Campaign-only fields land in fields.* — incl. the wf_campaign validator inputs.
    expect(item.fields).toMatchObject({ budget: 50000, objective: 'Awareness', platforms: 'Instagram', postsPlanned: 12 });
  });
});

describe('eventToWorkItem', () => {
  it('copies an event, keeping its display status and stashing extras in fields', () => {
    const item = eventToWorkItem(
      'e1',
      { name: 'Trade Expo', brands: ['Sosun Cola', 'Sosun Water'], status: 'Confirmed', startDate: '2026-08-01', venue: 'Hulhumalé' },
      NOW,
    );
    expect(item.typeId).toBe('event');
    expect(item.workflowId).toBe(LEGACY_TASK_WORKFLOW_ID);
    expect(item.status).toBe('Confirmed');
    expect(item.brandIds).toEqual(['Sosun Cola', 'Sosun Water']);
    expect(item.dueDate).toBe('2026-08-01'); // falls back to startDate
    expect(item.fields).toMatchObject({ venue: 'Hulhumalé' });
    expect(item.migratedFrom).toBe('events/e1');
  });

  it('defaults a missing status', () => {
    expect(eventToWorkItem('e2', {}, NOW).status).toBe(DEFAULT_LEGACY_STATUS);
  });
});

describe('prune / slugify', () => {
  it('drops undefined but keeps null and empty values', () => {
    expect(prune({ a: undefined, b: null, c: 0, d: '' })).toEqual({ b: null, c: 0, d: '' });
  });

  it('slugifies display names into transition ids', () => {
    expect(slugify('Submitted for Review')).toBe('submitted-for-review');
    expect(slugify('  To Do ')).toBe('to-do');
  });
});
