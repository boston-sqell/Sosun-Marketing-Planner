/**
 * Marketing Planner — request schemas (Zod).
 *
 * Same pattern as schemas/index.ts: validate() replaces req.body with the
 * parsed, whitelisted output. Update schemas are .strict() so unknown keys are
 * rejected (prevents mass-assignment, e.g. smuggling `status`/`workflowId`).
 */

import { z } from 'zod';

const priority = z.enum(['low', 'normal', 'high', 'urgent']);

export const CreatePlannerItemSchema = z.object({
  typeId: z.string().min(1, 'typeId is required').trim(),
  title: z.string().min(1, 'title is required').trim(),
  description: z.string().trim().optional().default(''),
  spaceId: z.string().min(1, 'spaceId is required').trim(),
  brandIds: z.array(z.string()).default([]),
  assigneeUids: z.array(z.string()).default([]),
  priority: priority.default('normal'),
  labels: z.array(z.string()).default([]),
  fields: z.record(z.string(), z.unknown()).default({}),
  parentId: z.string().nullable().default(null),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullable().default(null),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullable().default(null),
});

/**
 * Editable, non-status fields only. `status`/`workflowId`/`typeId` are absent by
 * design — status changes go exclusively through the transition endpoint (§4),
 * and .strict() rejects any attempt to include them.
 */
export const UpdatePlannerItemSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    brandIds: z.array(z.string()).optional(),
    assigneeUids: z.array(z.string()).optional(),
    watcherUids: z.array(z.string()).optional(),
    priority: priority.optional(),
    labels: z.array(z.string()).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

export const TransitionSchema = z.object({
  transitionId: z.string().min(1, 'transitionId is required').trim(),
});

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(5000).optional(),
});

export type CreatePlannerItem = z.infer<typeof CreatePlannerItemSchema>;
export type UpdatePlannerItem = z.infer<typeof UpdatePlannerItemSchema>;
