import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────

/** ISO-8601 date string (YYYY-MM-DD) */
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD date format')
  .optional()
  .default('');

/** ISO-8601 datetime string */
const datetimeStr = z.string().datetime().optional();

/** Non-empty trimmed string */
const requiredStr = z.string().min(1, 'Required').trim();

/** Optional trimmed string */
const optStr = z.string().trim().optional().default('');

// ── Task schemas ─────────────────────────────────────────────────────────────

const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean().default(false),
});

const CommentSchema = z.object({
  id: z.string(),
  userUid: z.string().optional(),
  user: z.string().optional(),
  role: z.string().optional(),
  text: z.string(),
  time: z.string().optional(),
  createdAt: z.string().optional(),
  internalOnly: z.boolean().default(false),
});

export const CreateTaskSchema = z.object({
  id: z.string().optional(), // Client may pre-generate; backend creates if missing
  title: requiredStr,
  brand: requiredStr,
  type: z.enum(['task', 'meeting']).default('task'),
  platforms: z.array(z.string()).default([]),
  contentType: optStr,
  campaignId: optStr,
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).default('Medium'),
  status: z.string().default('Idea'),
  statusId: z.string().optional(),
  assignedTo: z.string().default('Internal'),
  submittedBy: z.string().optional(), // Overridden server-side
  briefDate: dateStr,
  draftDueDate: dateStr,
  reviewDeadline: dateStr,
  sharedDate: dateStr,
  scheduledDate: dateStr,
  scheduledTime: optStr,
  publishedDate: dateStr,
  assetLink: optStr,
  caption: optStr,
  hashtags: optStr,
  notes: optStr,
  checklist: z.array(ChecklistItemSchema).default([]),
  comments: z.array(CommentSchema).default([]),
  progress: z.number().int().min(0).max(100).default(0),
  // Meeting-specific fields
  visibility: z.enum(['internal', 'agency', 'external']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().optional(),
  agenda: z.string().optional(),
  invitedGuests: z.array(z.string()).optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  brand: z.string().trim().min(1).optional(),
  type: z.enum(['task', 'meeting']).optional(),
  platforms: z.array(z.string()).optional(),
  contentType: z.string().optional(),
  campaignId: z.string().optional(),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
  status: z.string().optional(),
  statusId: z.string().optional(),
  statusPhase: z.string().optional(),
  isTerminal: z.boolean().optional(),
  assignedTo: z.string().optional(),
  sharedDate: z.string().optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().optional(),
  assetLink: z.string().optional(),
  caption: z.string().optional(),
  notes: z.string().optional(),
  checklist: z.array(ChecklistItemSchema).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  // Meeting fields
  visibility: z.enum(['internal', 'agency', 'external']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().optional(),
  agenda: z.string().optional(),
  invitedGuests: z.array(z.string()).optional(),
}).strict(); // Reject any unknown keys

export const AddCommentSchema = z.object({
  text: z.string().min(1, 'Comment text is required').max(5000),
  internalOnly: z.boolean().default(false),
});

export const EditCommentSchema = z.object({
  text: z.string().min(1, 'Comment text is required').max(5000),
});

// ── Campaign schemas ─────────────────────────────────────────────────────────

export const CreateCampaignSchema = z.object({
  id: z.string().optional(),
  name: requiredStr,
  brand: requiredStr,
  type: z.string().default('Seasonal'),
  startDate: dateStr,
  endDate: dateStr,
  status: z.enum(['Draft', 'Planning', 'Active', 'Completed']).default('Draft'),
  objective: optStr,
  platforms: z.string().default(''), // Stored as comma-separated string
  postsPlanned: z.number().int().min(0).default(0),
  budget: z.number().min(0).default(0),
  notes: optStr,
  assetLink: optStr,
  assetLinks: z.array(z.string()).default([]),
  checklist: z.array(ChecklistItemSchema).default([]),
});

// ── Budget schemas ───────────────────────────────────────────────────────────

const BudgetCategory = z.enum([
  'media', 'production', 'sponsorship', 'logistics', 'print',
  'marketing-agency', 'billboards', 'tasting-events', 'other',
]);

export const CreateBudgetEntrySchema = z.object({
  brand: requiredStr,
  campaignId: z.string().nullable().default(null),
  eventId: z.string().nullable().default(null),
  category: BudgetCategory,
  description: requiredStr,
  notes: z.string().nullable().default(null),
  amount: z.number().positive('Amount must be positive'),
  currency: z.enum(['MVR', 'USD']).default('MVR'),
  spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

// ── Event schemas ────────────────────────────────────────────────────────────

// Mirrors EventData / EventType / EventStatus in frontend/src/types.ts.
export const CreateEventSchema = z.object({
  name: requiredStr,
  type: z.enum(['tradeshow', 'exhibition', 'sponsorship', 'activation']).default('tradeshow'),
  venue: optStr,
  city: optStr,
  brands: z.array(z.string()).min(1, 'At least one brand is required'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  status: z.enum(['Scoping', 'Confirmed', 'Preparing', 'Live', 'Wrapped', 'Reported']).default('Scoping'),
  sponsorshipCost: z.number().min(0).default(0),
  expectedFootfall: z.number().min(0).optional(),
  leadsCaptured: z.number().min(0).optional(),
  salesAttributed: z.number().min(0).optional(),
  notes: optStr,
});

// ── Type exports ─────────────────────────────────────────────────────────────

export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;
export type AddComment = z.infer<typeof AddCommentSchema>;
export type EditComment = z.infer<typeof EditCommentSchema>;
export type CreateCampaign = z.infer<typeof CreateCampaignSchema>;
export type CreateBudgetEntry = z.infer<typeof CreateBudgetEntrySchema>;
export type CreateEvent = z.infer<typeof CreateEventSchema>;
