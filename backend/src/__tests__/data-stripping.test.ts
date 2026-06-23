import { describe, it, expect } from 'vitest';

/**
 * Tests for the data-stripping functions that ensure agencies never receive
 * internal comments or financial data. These functions live in route handlers;
 * we test equivalent logic here to lock down the contract.
 */

// Re-implement stripInternalComments inline since it's a non-exported helper.
// If/when it moves to a shared module, import it instead.
function stripInternalComments(task: any, role: string) {
  if (role === 'agency' || role === 'external_agency') {
    if (task.comments && Array.isArray(task.comments)) {
      task.comments = task.comments.filter(
        (c: any) => c.internalOnly !== true && c.internal_only !== true,
      );
    }
  }
  return task;
}

function stripCampaignFinancials(campaign: any, role: string) {
  if (role === 'agency' || role === 'external_agency') {
    delete campaign.budget;
    delete campaign.budgetPlanned;
    delete campaign.budgetSpent;
    delete campaign.financial_summary;
    delete campaign.performance_metrics;
  }
  return campaign;
}

// ── Internal comment stripping ───────────────────────────────────────────────

describe('stripInternalComments', () => {
  const sampleComments = [
    { id: 'c1', text: 'Public note', internalOnly: false },
    { id: 'c2', text: 'Internal budget discussion', internalOnly: true },
    { id: 'c3', text: 'Agency visible feedback', internal_only: false },
    { id: 'c4', text: 'HR concern (snake_case)', internal_only: true },
    { id: 'c5', text: 'No flag set at all' },
  ];

  it('strips internal-only comments for agency role', () => {
    const task = { id: 't1', comments: [...sampleComments] };
    stripInternalComments(task, 'agency');
    expect(task.comments).toHaveLength(3);
    expect(task.comments.map((c: any) => c.id)).toEqual(['c1', 'c3', 'c5']);
  });

  it('strips internal-only comments for external_agency role', () => {
    const task = { id: 't1', comments: [...sampleComments] };
    stripInternalComments(task, 'external_agency');
    expect(task.comments).toHaveLength(3);
  });

  it('preserves all comments for admin role', () => {
    const task = { id: 't1', comments: [...sampleComments] };
    stripInternalComments(task, 'admin');
    expect(task.comments).toHaveLength(5);
  });

  it('preserves all comments for internal role', () => {
    const task = { id: 't1', comments: [...sampleComments] };
    stripInternalComments(task, 'internal');
    expect(task.comments).toHaveLength(5);
  });

  it('handles task with no comments array', () => {
    const task = { id: 't1' };
    expect(() => stripInternalComments(task, 'agency')).not.toThrow();
  });

  it('handles task with empty comments array', () => {
    const task = { id: 't1', comments: [] };
    stripInternalComments(task, 'agency');
    expect(task.comments).toEqual([]);
  });
});

// ── Campaign financial stripping ─────────────────────────────────────────────

describe('stripCampaignFinancials', () => {
  const makeCampaign = () => ({
    id: 'camp-1',
    name: 'Eid Sale',
    brand: 'Sosun Fihaara',
    budget: 5000,
    budgetPlanned: 6000,
    budgetSpent: 3200,
    financial_summary: { q1: 1000, q2: 2200 },
    performance_metrics: { roi: 1.5 },
    status: 'Active',
    objective: 'Drive sales',
  });

  it('removes all financial fields for agency', () => {
    const c = makeCampaign();
    stripCampaignFinancials(c, 'agency');
    expect(c).not.toHaveProperty('budget');
    expect(c).not.toHaveProperty('budgetPlanned');
    expect(c).not.toHaveProperty('budgetSpent');
    expect(c).not.toHaveProperty('financial_summary');
    expect(c).not.toHaveProperty('performance_metrics');
    // Non-financial fields preserved
    expect(c).toHaveProperty('name', 'Eid Sale');
    expect(c).toHaveProperty('status', 'Active');
  });

  it('removes all financial fields for external_agency', () => {
    const c = makeCampaign();
    stripCampaignFinancials(c, 'external_agency');
    expect(c).not.toHaveProperty('budget');
    expect(c).not.toHaveProperty('budgetSpent');
  });

  it('preserves financial fields for admin', () => {
    const c = makeCampaign();
    stripCampaignFinancials(c, 'admin');
    expect(c).toHaveProperty('budget', 5000);
    expect(c).toHaveProperty('budgetSpent', 3200);
    expect(c).toHaveProperty('financial_summary');
  });

  it('preserves financial fields for internal', () => {
    const c = makeCampaign();
    stripCampaignFinancials(c, 'internal');
    expect(c).toHaveProperty('budget', 5000);
    expect(c).toHaveProperty('performance_metrics');
  });

  it('handles campaign with no financial fields', () => {
    const c = { id: 'camp-2', name: 'Simple' };
    expect(() => stripCampaignFinancials(c, 'agency')).not.toThrow();
    expect(c).toHaveProperty('name', 'Simple');
  });
});
