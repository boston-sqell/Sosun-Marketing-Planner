import { describe, it, expect } from 'vitest';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  AddCommentSchema,
  CreateCampaignSchema,
  CreateBudgetEntrySchema,
} from '../schemas';

describe('CreateTaskSchema', () => {
  it('accepts a valid minimal task', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Eid Promo Reels',
      brand: 'Sosun Fihaara',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Eid Promo Reels');
      expect(result.data.priority).toBe('Medium'); // default
      expect(result.data.type).toBe('task'); // default
      expect(result.data.checklist).toEqual([]);
    }
  });

  it('rejects empty title', () => {
    const result = CreateTaskSchema.safeParse({
      title: '',
      brand: 'Sosun Fihaara',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing brand', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Some Task',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Task',
      brand: 'Brand',
      priority: 'MEGA_URGENT',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a full meeting payload', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Weekly Sync',
      brand: 'Sosun Cook',
      type: 'meeting',
      visibility: 'agency',
      startDate: '2026-07-01T10:00',
      endDate: '2026-07-01T11:00',
      location: 'Board Room',
      agenda: 'Review Q3 plans',
      invitedGuests: ['guest@example.com'],
    });
    expect(result.success).toBe(true);
  });

  it('clamps progress to 0-100', () => {
    const overResult = CreateTaskSchema.safeParse({
      title: 'Task',
      brand: 'Brand',
      progress: 150,
    });
    expect(overResult.success).toBe(false);

    const negResult = CreateTaskSchema.safeParse({
      title: 'Task',
      brand: 'Brand',
      progress: -10,
    });
    expect(negResult.success).toBe(false);
  });
});

describe('UpdateTaskSchema', () => {
  it('accepts a partial update', () => {
    const result = UpdateTaskSchema.safeParse({
      status: 'Approved',
      statusId: 'approved',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty update (no fields)', () => {
    const result = UpdateTaskSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (mass-assignment protection)', () => {
    const result = UpdateTaskSchema.safeParse({
      status: 'Approved',
      secretAdminField: 'pwned',
    });
    // .strict() should reject unknown keys
    expect(result.success).toBe(false);
  });

  it('rejects checklist update with invalid items', () => {
    const result = UpdateTaskSchema.safeParse({
      checklist: [{ text: 'item without id' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('AddCommentSchema', () => {
  it('accepts a valid comment', () => {
    const result = AddCommentSchema.safeParse({
      text: 'Looks great!',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.internalOnly).toBe(false); // default
    }
  });

  it('accepts internal-only flag', () => {
    const result = AddCommentSchema.safeParse({
      text: 'Budget concern',
      internalOnly: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.internalOnly).toBe(true);
    }
  });

  it('rejects empty comment', () => {
    const result = AddCommentSchema.safeParse({
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects overly long comment', () => {
    const result = AddCommentSchema.safeParse({
      text: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateCampaignSchema', () => {
  it('accepts a valid campaign', () => {
    const result = CreateCampaignSchema.safeParse({
      name: 'Eid Sale',
      brand: 'Sosun Fihaara',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('Draft'); // default
      expect(result.data.budget).toBe(0); // default
    }
  });

  it('rejects invalid date format', () => {
    const result = CreateCampaignSchema.safeParse({
      name: 'Campaign',
      brand: 'Brand',
      startDate: '06/01/2026', // wrong format
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateBudgetEntrySchema', () => {
  it('accepts a valid entry', () => {
    const result = CreateBudgetEntrySchema.safeParse({
      brand: 'Sosun Cook',
      category: 'media',
      description: 'Instagram boost June',
      amount: 500,
      spentAt: '2026-06-15',
    });
    expect(result.success).toBe(true);
  });

  it('rejects zero amount', () => {
    const result = CreateBudgetEntrySchema.safeParse({
      brand: 'Sosun Cook',
      category: 'media',
      description: 'Free entry',
      amount: 0,
      spentAt: '2026-06-15',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = CreateBudgetEntrySchema.safeParse({
      brand: 'Sosun Cook',
      category: 'media',
      description: 'Refund',
      amount: -100,
      spentAt: '2026-06-15',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = CreateBudgetEntrySchema.safeParse({
      brand: 'Brand',
      category: 'crypto-mining',
      description: 'Test',
      amount: 100,
      spentAt: '2026-06-15',
    });
    expect(result.success).toBe(false);
  });
});
