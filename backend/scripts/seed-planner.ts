/**
 * Marketing Planner — Phase 1 seed (idempotent).
 *
 * Seeds the minimum config the engine needs to run end-to-end:
 *   - workflows/wf_campaign     the Campaign workflow (spec §3.4)
 *   - workItemTypes/campaign    Campaign type → wf_campaign
 *   - customFields/{budget,objective}   two fields used by the workflow validators
 *
 * Existing docs are overwritten (config is developer-owned until the Phase 5
 * settings panel lands), so this is safe to re-run.
 *
 * Run from backend/:  npx ts-node scripts/seed-planner.ts
 * Requires FIREBASE_SERVICE_ACCOUNT in .env or Application Default Credentials.
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';
import { Workflow } from '../src/lib/planner/types';

const CAMPAIGN_WORKFLOW: Workflow = {
  id: 'wf_campaign',
  name: 'Campaign workflow',
  initialStatus: 'created',
  statuses: [
    { id: 'created', name: 'Created', category: 'todo', color: '#8b8b8b' },
    { id: 'planning', name: 'Planning', category: 'todo', color: '#3b82f6' },
    { id: 'approval', name: 'Pending Approval', category: 'in_progress', color: '#f59e0b' },
    { id: 'approved', name: 'Approved', category: 'in_progress', color: '#10b981' },
    { id: 'inprogress', name: 'In Progress', category: 'in_progress', color: '#6366f1' },
    { id: 'review', name: 'Review', category: 'in_progress', color: '#ec4899' },
    { id: 'scheduled', name: 'Scheduled', category: 'in_progress', color: '#14b8a6' },
    { id: 'completed', name: 'Completed', category: 'done', color: '#22c55e' },
    { id: 'archived', name: 'Archived', category: 'done', color: '#525252' },
  ],
  transitions: [
    {
      id: 'start_planning',
      name: 'Start planning',
      from: ['created'],
      to: 'planning',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
    },
    {
      id: 'submit_for_approval',
      name: 'Submit for approval',
      from: ['planning'],
      to: 'approval',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
      validators: [
        { type: 'fieldRequired', fieldId: 'budget' },
        { type: 'fieldRequired', fieldId: 'objective' },
        { type: 'descriptionRequired' },
      ],
      postFunctions: [
        { type: 'lockEditing' },
        { type: 'startApproval', approvalChainId: 'campaign_approval' },
        { type: 'notify', audience: 'approvers', template: 'approval_requested' },
      ],
    },
    {
      // Fired by the approval chain (onApprove) once every stage signs off.
      // approvalComplete guards it so it can't be forced before sign-off.
      id: 'approve',
      name: 'Approve',
      from: ['approval'],
      to: 'approved',
      conditions: [{ type: 'role', roles: ['admin'] }],
      validators: [{ type: 'approvalComplete' }],
      postFunctions: [{ type: 'unlockEditing' }],
    },
    {
      // Fired by the approval chain (onReject) when any stage rejects.
      id: 'reject',
      name: 'Reject',
      from: ['approval'],
      to: 'planning',
      conditions: [{ type: 'role', roles: ['admin'] }],
      postFunctions: [{ type: 'unlockEditing' }],
    },
    {
      id: 'begin_work',
      name: 'Begin work',
      from: ['approved'],
      to: 'inprogress',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
    },
    {
      id: 'send_to_review',
      name: 'Send to review',
      from: ['inprogress'],
      to: 'review',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
    },
    {
      id: 'schedule',
      name: 'Schedule',
      from: ['review'],
      to: 'scheduled',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
      validators: [{ type: 'dueDateRequired' }],
    },
    {
      id: 'complete',
      name: 'Mark completed',
      from: ['scheduled', 'inprogress', 'review'],
      to: 'completed',
      conditions: [{ type: 'role', roles: ['admin', 'internal'] }],
      validators: [{ type: 'subtasksDone' }],
    },
    {
      id: 'archive',
      name: 'Archive',
      from: ['completed'],
      to: 'archived',
      conditions: [{ type: 'role', roles: ['admin'] }],
      postFunctions: [{ type: 'archiveAssets' }],
    },
  ],
};

const CAMPAIGN_TYPE = {
  name: 'Campaign',
  icon: 'megaphone',
  workflowId: 'wf_campaign',
  fieldIds: ['budget', 'objective'],
  archived: false,
};

// A lightweight 3-status workflow for creative deliverables spawned by automation.
const SIMPLE_WORKFLOW: Workflow = {
  id: 'wf_simple',
  name: 'Simple workflow',
  initialStatus: 'todo',
  statuses: [
    { id: 'todo', name: 'To Do', category: 'todo', color: '#8b8b8b' },
    { id: 'doing', name: 'In Progress', category: 'in_progress', color: '#6366f1' },
    { id: 'done', name: 'Done', category: 'done', color: '#22c55e' },
  ],
  transitions: [
    { id: 'start', name: 'Start', from: ['todo'], to: 'doing', conditions: [{ type: 'role', roles: ['admin', 'internal', 'creative'] }] },
    { id: 'finish', name: 'Mark done', from: ['doing'], to: 'done', conditions: [{ type: 'role', roles: ['admin', 'internal', 'creative'] }] },
  ],
};

const CREATIVE_TASK_TYPE = {
  name: 'Creative Task',
  icon: 'palette',
  workflowId: 'wf_simple',
  fieldIds: [],
  archived: false,
};

// Template: a creative bundle (root + two deliverable subtasks), relative dates.
const CREATIVE_BUNDLE_TEMPLATE = {
  name: 'Creative bundle',
  root: { typeId: 'creative_task', title: 'Creative bundle', dueInDays: 14 },
  subtasks: [
    { typeId: 'creative_task', title: 'Social post', dueInDays: 7 },
    { typeId: 'creative_task', title: 'Key visual', dueInDays: 10 },
  ],
};

// Automation: when a campaign is approved, spawn the creative bundle as subtasks,
// assign the creative team, and set the campaign due date 30 days out.
const ON_CAMPAIGN_APPROVED_AUTOMATION = {
  name: 'On campaign approved → spawn creative bundle',
  trigger: { type: 'statusEntered', statusId: 'approved', typeIds: ['campaign'] },
  conditions: [],
  actions: [
    { type: 'createWorkItems', templateId: 'tpl_creative_bundle', linkAsSubtasks: true },
    { type: 'assignRole', role: 'creative' },
    { type: 'setDueDate', relativeDays: 30 },
    { type: 'notify', audience: 'assignees', template: 'work_assigned' },
  ],
  enabled: true,
};

const CUSTOM_FIELDS = [
  { id: 'budget', label: 'Budget (MVR)', type: 'currency', options: [], archived: false },
  { id: 'objective', label: 'Objective', type: 'longtext', options: [], archived: false },
];

/**
 * Campaign approval chain (spec §3.5). Two role-based `any` stages — one manager
 * sign-off, then one management sign-off. onApprove/onReject drive the workflow.
 * (all/majority modes need an explicit approverUids list or minApprovals — see
 * ApprovalStage in lib/planner/types.ts.)
 */
const CAMPAIGN_APPROVAL_CHAIN = {
  name: 'Campaign approval',
  stages: [
    { name: 'Marketing Manager', approverRoles: ['manager', 'admin'], mode: 'any' },
    { name: 'Management', approverRoles: ['management', 'admin'], mode: 'any' },
  ],
  onApprove: 'approve',
  onReject: 'reject',
};

/**
 * Default planner-role permission matrix (plannerConfig/roles, spec §10.2).
 * Every capability defaults to false where unlisted (the resolver fails closed).
 * Editable in the Phase 5 settings panel; developer-owned until then.
 */
const ROLES_CONFIG = {
  roles: {
    admin: {
      permissions: {
        createItem: true, editItem: true, deleteItem: true, archiveItem: true,
        assign: true, comment: true, uploadFile: true, approve: true, manageConfig: true, export: true,
      },
    },
    management: {
      permissions: { archiveItem: true, assign: true, comment: true, approve: true, export: true },
    },
    manager: {
      permissions: {
        createItem: true, editItem: true, archiveItem: true,
        assign: true, comment: true, uploadFile: true, approve: true, export: true,
      },
    },
    marketing: {
      permissions: { createItem: true, editItem: true, assign: true, comment: true, uploadFile: true },
    },
    creative: {
      permissions: { createItem: true, editItem: true, comment: true, uploadFile: true },
    },
    agency: {
      permissions: { comment: true, uploadFile: true },
      // Agency is confined to the Creative space and only their own items.
      spaces: { creative: { onlyAssignee: true } },
    },
    readonly: {
      permissions: {},
    },
  },
};

async function main() {
  console.log('Seeding Marketing Planner Phase 1 config…');

  await db.collection('workflows').doc(CAMPAIGN_WORKFLOW.id).set(CAMPAIGN_WORKFLOW);
  console.log(`+ workflows/${CAMPAIGN_WORKFLOW.id} (${CAMPAIGN_WORKFLOW.transitions.length} transitions)`);

  await db.collection('workflows').doc(SIMPLE_WORKFLOW.id).set(SIMPLE_WORKFLOW);
  console.log(`+ workflows/${SIMPLE_WORKFLOW.id}`);

  await db.collection('workItemTypes').doc('campaign').set(CAMPAIGN_TYPE);
  console.log('+ workItemTypes/campaign');

  await db.collection('workItemTypes').doc('creative_task').set(CREATIVE_TASK_TYPE);
  console.log('+ workItemTypes/creative_task');

  for (const f of CUSTOM_FIELDS) {
    const { id, ...rest } = f;
    await db.collection('customFields').doc(id).set(rest);
    console.log(`+ customFields/${id}`);
  }

  await db.collection('plannerConfig').doc('roles').set(ROLES_CONFIG);
  console.log(`+ plannerConfig/roles (${Object.keys(ROLES_CONFIG.roles).length} roles)`);

  await db.collection('approvalChains').doc('campaign_approval').set(CAMPAIGN_APPROVAL_CHAIN);
  console.log(`+ approvalChains/campaign_approval (${CAMPAIGN_APPROVAL_CHAIN.stages.length} stages)`);

  await db.collection('templates').doc('tpl_creative_bundle').set(CREATIVE_BUNDLE_TEMPLATE);
  console.log(`+ templates/tpl_creative_bundle (${CREATIVE_BUNDLE_TEMPLATE.subtasks.length} subtasks)`);

  await db.collection('automations').doc('on_campaign_approved').set(ON_CAMPAIGN_APPROVED_AUTOMATION);
  console.log('+ automations/on_campaign_approved');

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
