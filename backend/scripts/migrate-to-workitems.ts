/**
 * Marketing Planner — absorption migration (docs/planner/spec-revisions.md §1).
 *
 * Promotes the legacy `tasks` collection to the general work-item store and
 * folds `campaigns`, `events` and the Phase-1 `workItems` collection into it:
 *
 *   1. Seeds workflows/wf_task (legacy display-name statuses; see absorb.ts
 *      design note) + workItemTypes/{task,meeting,event}.
 *   2. Upgrades every legacy tasks/{id} doc in place (merge; never rewrites
 *      `status`, never clobbers existing values; skips docs that already have
 *      a workflowId — so re-runs are no-ops).
 *   3. Copies campaigns/{id} → tasks/{id} as typeId "campaign" (source left
 *      read-only until the frontend cuts over; marked with absorbedAt).
 *   4. Copies events/{id} → tasks/{id} as typeId "event" (packingItems /
 *      logistics subcollections stay on events/{id}).
 *   5. Moves workItems/{id} → tasks/{id} including activity / attachments /
 *      comments subcollections (Phase-1 demo data). Sources are marked
 *      `movedTo`; pass --delete-workitems to delete them after copying.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/migrate-to-workitems.ts --dry-run
 *   npx ts-node scripts/migrate-to-workitems.ts
 *   npx ts-node scripts/migrate-to-workitems.ts --delete-workitems
 *
 * ORDER OF OPERATIONS (see docs/planner/absorption-runbook.md):
 * deploy §14.4 indexes → run this script → deploy backend with
 * WORK_ITEMS_COLLECTION = 'tasks' → deploy rules. Do NOT deploy the flipped
 * backend before this script has run.
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';
import {
  buildLegacyTaskWorkflow,
  campaignToWorkItem,
  eventToWorkItem,
  upgradeLegacyTaskPatch,
  LEGACY_TASK_WORKFLOW_ID,
} from '../src/lib/planner/absorb';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DELETE_WORKITEMS = args.includes('--delete-workitems');
const now = new Date().toISOString();

const report = {
  tasksUpgraded: 0,
  tasksAlreadyMigrated: 0,
  campaignsCopied: 0,
  campaignsSkipped: 0,
  eventsCopied: 0,
  eventsSkipped: 0,
  workItemsMoved: 0,
  workItemsSkipped: 0,
  subDocsCopied: 0,
  warnings: [] as string[],
};

function log(line: string) {
  // eslint-disable-next-line no-console
  console.log(line);
}

/** Batched writer: flushes every 400 ops (Firestore cap is 500). */
class BatchWriter {
  private batch = db.batch();
  private ops = 0;
  async set(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>, merge = false) {
    if (DRY_RUN) return;
    this.batch.set(ref, data, { merge });
    if (++this.ops >= 400) await this.flush();
  }
  async delete(ref: FirebaseFirestore.DocumentReference) {
    if (DRY_RUN) return;
    this.batch.delete(ref);
    if (++this.ops >= 400) await this.flush();
  }
  async flush() {
    if (DRY_RUN || this.ops === 0) return;
    await this.batch.commit();
    this.batch = db.batch();
    this.ops = 0;
  }
}

/** Best-effort map of display names → uid for assigneeUids backfill. */
async function loadNameToUid(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const snap = await db.collection('users').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    for (const key of [d.displayName, d.name, d.username]) {
      if (typeof key === 'string' && key.trim()) map.set(key.toLowerCase().trim(), doc.id);
    }
  }
  return map;
}

async function copySubcollections(
  from: FirebaseFirestore.DocumentReference,
  to: FirebaseFirestore.DocumentReference,
  writer: BatchWriter,
) {
  for (const name of ['activity', 'attachments', 'comments']) {
    const snap = await from.collection(name).get();
    for (const doc of snap.docs) {
      await writer.set(to.collection(name).doc(doc.id), doc.data());
      report.subDocsCopied++;
    }
  }
}

async function main() {
  log('====================================================');
  log(`ABSORPTION MIGRATION — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE RUN'}`);
  log('====================================================\n');

  const [tasksSnap, campaignsSnap, eventsSnap, workItemsSnap, nameToUid] = await Promise.all([
    db.collection('tasks').get(),
    db.collection('campaigns').get(),
    db.collection('events').get(),
    db.collection('workItems').get(),
    loadNameToUid(),
  ]);
  log(`tasks: ${tasksSnap.size} · campaigns: ${campaignsSnap.size} · events: ${eventsSnap.size} · workItems: ${workItemsSnap.size}\n`);

  const writer = new BatchWriter();

  // 1. wf_task from canon + statuses observed in the wild (tasks + events).
  const observed = new Set<string>();
  for (const doc of tasksSnap.docs) {
    const s = doc.data().status;
    if (typeof s === 'string' && s.trim()) observed.add(s.trim());
  }
  for (const doc of eventsSnap.docs) {
    const s = doc.data().status;
    if (typeof s === 'string' && s.trim()) observed.add(s.trim());
  }
  const wfTask = buildLegacyTaskWorkflow([...observed]);
  await writer.set(db.collection('workflows').doc(LEGACY_TASK_WORKFLOW_ID), wfTask as unknown as Record<string, unknown>);
  log(`+ workflows/${LEGACY_TASK_WORKFLOW_ID} (${wfTask.statuses.length} statuses, ${wfTask.transitions.length} transitions)`);

  const TYPES: Array<[string, Record<string, unknown>]> = [
    ['task', { name: 'Task', icon: 'check-square', workflowId: LEGACY_TASK_WORKFLOW_ID, fieldIds: [], archived: false }],
    ['meeting', { name: 'Meeting', icon: 'calendar', workflowId: LEGACY_TASK_WORKFLOW_ID, fieldIds: [], archived: false }],
    ['event', { name: 'Event', icon: 'flag', workflowId: LEGACY_TASK_WORKFLOW_ID, fieldIds: [], archived: false }],
  ];
  for (const [id, data] of TYPES) {
    const existing = await db.collection('workItemTypes').doc(id).get();
    if (!existing.exists) {
      await writer.set(db.collection('workItemTypes').doc(id), data);
      log(`+ workItemTypes/${id}`);
    }
  }

  // 2. Upgrade legacy tasks in place.
  for (const doc of tasksSnap.docs) {
    const patch = upgradeLegacyTaskPatch(doc.data(), now, nameToUid);
    if (!patch) {
      report.tasksAlreadyMigrated++;
      continue;
    }
    await writer.set(doc.ref, patch, true);
    report.tasksUpgraded++;
  }
  log(`~ tasks upgraded: ${report.tasksUpgraded} (already migrated: ${report.tasksAlreadyMigrated})`);

  // 3 + 4. Copy campaigns and events in (same doc id; idempotent via migratedFrom).
  const copyIn = async (
    snap: FirebaseFirestore.QuerySnapshot,
    kind: 'campaign' | 'event',
  ) => {
    for (const doc of snap.docs) {
      const target = db.collection('tasks').doc(doc.id);
      const existing = await target.get();
      const item =
        kind === 'campaign' ? campaignToWorkItem(doc.id, doc.data(), now) : eventToWorkItem(doc.id, doc.data(), now);
      if (existing.exists) {
        const from = existing.data()?.migratedFrom;
        if (from === item.migratedFrom) {
          kind === 'campaign' ? report.campaignsSkipped++ : report.eventsSkipped++;
        } else {
          report.warnings.push(`tasks/${doc.id} exists and is not from ${item.migratedFrom} — ${kind} NOT copied`);
        }
        continue;
      }
      const { id, ...data } = item as unknown as Record<string, unknown>;
      await writer.set(target, data);
      await writer.set(doc.ref, { absorbedAt: now }, true);
      kind === 'campaign' ? report.campaignsCopied++ : report.eventsCopied++;
    }
  };
  await copyIn(campaignsSnap, 'campaign');
  log(`+ campaigns copied: ${report.campaignsCopied} (skipped: ${report.campaignsSkipped})`);
  await copyIn(eventsSnap, 'event');
  log(`+ events copied: ${report.eventsCopied} (skipped: ${report.eventsSkipped})`);

  // 5. Move Phase-1 workItems (docs + audit subcollections), same ids.
  for (const doc of workItemsSnap.docs) {
    const data = doc.data();
    if (data.movedTo) {
      report.workItemsSkipped++;
      continue;
    }
    const target = db.collection('tasks').doc(doc.id);
    const existing = await target.get();
    if (existing.exists) {
      report.warnings.push(`tasks/${doc.id} already exists — workItems/${doc.id} NOT moved`);
      continue;
    }
    await writer.set(target, { ...data, absorbedAt: now });
    await copySubcollections(doc.ref, target, writer);
    if (DELETE_WORKITEMS) {
      await writer.delete(doc.ref);
    } else {
      await writer.set(doc.ref, { movedTo: `tasks/${doc.id}`, movedAt: now }, true);
    }
    report.workItemsMoved++;
  }
  log(`+ workItems moved: ${report.workItemsMoved} (skipped: ${report.workItemsSkipped}, subdocs: ${report.subDocsCopied})`);

  await writer.flush();

  log('\n──────────────── SUMMARY ────────────────');
  log(JSON.stringify(report, null, 2));
  if (report.warnings.length > 0) {
    log(`\n⚠ ${report.warnings.length} warning(s) — review before deploying the flipped backend.`);
  }
  log(DRY_RUN ? '\nDry run only — nothing was written.' : '\nDone. Next: deploy backend (flipped constant), then rules.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
