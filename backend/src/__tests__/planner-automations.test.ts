import { describe, it, expect } from 'vitest';
import { matchesTrigger, passesConditions, selectAutomations } from '../lib/planner/automations';
import { computeDueDate } from '../lib/planner/templates';
import { Automation, AutomationEvent, WorkItem } from '../lib/planner/types';

/*
 * Unit tests for the pure automation matcher + template date helper.
 */

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'i1',
  typeId: 'campaign',
  workflowId: 'wf_campaign',
  title: 'C',
  spaceId: 'marketing',
  status: 'approved',
  fields: {},
  ...over,
});

const auto = (over: Partial<Automation> = {}): Automation => ({
  id: 'a1',
  name: 'test',
  trigger: { type: 'statusEntered', statusId: 'approved', typeIds: ['campaign'] },
  actions: [{ type: 'setDueDate', relativeDays: 30 }],
  enabled: true,
  ...over,
});

const statusEntered = (statusId: string, typeId = 'campaign'): AutomationEvent => ({ type: 'statusEntered', statusId, typeId });

// ── matchesTrigger ────────────────────────────────────────────────────────────

describe('matchesTrigger', () => {
  it('matches statusEntered on the right status + type', () => {
    expect(matchesTrigger(auto(), statusEntered('approved'))).toBe(true);
  });
  it('rejects a different status', () => {
    expect(matchesTrigger(auto(), statusEntered('planning'))).toBe(false);
  });
  it('rejects a different event type', () => {
    expect(matchesTrigger(auto(), { type: 'itemCreated', typeId: 'campaign' })).toBe(false);
  });
  it('rejects a type not in the trigger typeIds', () => {
    expect(matchesTrigger(auto(), statusEntered('approved', 'creative_task'))).toBe(false);
  });
  it('matches any type when typeIds is omitted', () => {
    const a = auto({ trigger: { type: 'statusEntered', statusId: 'approved' } });
    expect(matchesTrigger(a, statusEntered('approved', 'anything'))).toBe(true);
  });
  it('matches itemCreated triggers', () => {
    const a = auto({ trigger: { type: 'itemCreated', typeIds: ['campaign'] } });
    expect(matchesTrigger(a, { type: 'itemCreated', typeId: 'campaign' })).toBe(true);
  });
});

// ── passesConditions ──────────────────────────────────────────────────────────

describe('passesConditions', () => {
  it('true with no conditions', () => {
    expect(passesConditions(undefined, item())).toBe(true);
    expect(passesConditions([], item())).toBe(true);
  });
  it('fieldEquals matches on value', () => {
    const c = [{ type: 'fieldEquals' as const, fieldId: 'needsCreative', value: true }];
    expect(passesConditions(c, item({ fields: { needsCreative: true } }))).toBe(true);
    expect(passesConditions(c, item({ fields: { needsCreative: false } }))).toBe(false);
    expect(passesConditions(c, item({ fields: {} }))).toBe(false);
  });
});

// ── selectAutomations ─────────────────────────────────────────────────────────

describe('selectAutomations', () => {
  it('returns only enabled, matching automations', () => {
    const enabled = auto({ id: 'on' });
    const disabled = auto({ id: 'off', enabled: false });
    const otherStatus = auto({ id: 'other', trigger: { type: 'statusEntered', statusId: 'planning', typeIds: ['campaign'] } });
    const selected = selectAutomations([enabled, disabled, otherStatus], statusEntered('approved'), item());
    expect(selected.map((a) => a.id)).toEqual(['on']);
  });

  it('honours conditions when selecting', () => {
    const a = auto({ conditions: [{ type: 'fieldEquals', fieldId: 'needsCreative', value: true }] });
    expect(selectAutomations([a], statusEntered('approved'), item({ fields: { needsCreative: true } }))).toHaveLength(1);
    expect(selectAutomations([a], statusEntered('approved'), item({ fields: {} }))).toHaveLength(0);
  });
});

// ── computeDueDate ────────────────────────────────────────────────────────────

describe('computeDueDate', () => {
  const NOW = '2026-07-02T10:00:00.000Z';
  it('adds days and returns YYYY-MM-DD', () => {
    expect(computeDueDate(NOW, 7)).toBe('2026-07-09');
    expect(computeDueDate(NOW, 0)).toBe('2026-07-02');
  });
  it('returns null when dueInDays is unset', () => {
    expect(computeDueDate(NOW, undefined)).toBeNull();
  });
  it('rolls over months', () => {
    expect(computeDueDate('2026-07-30T00:00:00.000Z', 5)).toBe('2026-08-04');
  });
});
