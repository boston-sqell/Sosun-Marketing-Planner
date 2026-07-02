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
      id: 'approve',
      name: 'Approve',
      from: ['approval'],
      to: 'approved',
      conditions: [{ type: 'role', roles: ['admin'] }],
      postFunctions: [{ type: 'unlockEditing' }],
    },
    {
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

const CUSTOM_FIELDS = [
  { id: 'budget', label: 'Budget (MVR)', type: 'currency', options: [], archived: false },
  { id: 'objective', label: 'Objective', type: 'longtext', options: [], archived: false },
];

async function main() {
  console.log('Seeding Marketing Planner Phase 1 config…');

  await db.collection('workflows').doc(CAMPAIGN_WORKFLOW.id).set(CAMPAIGN_WORKFLOW);
  console.log(`+ workflows/${CAMPAIGN_WORKFLOW.id} (${CAMPAIGN_WORKFLOW.transitions.length} transitions)`);

  await db.collection('workItemTypes').doc('campaign').set(CAMPAIGN_TYPE);
  console.log('+ workItemTypes/campaign');

  for (const f of CUSTOM_FIELDS) {
    const { id, ...rest } = f;
    await db.collection('customFields').doc(id).set(rest);
    console.log(`+ customFields/${id}`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
