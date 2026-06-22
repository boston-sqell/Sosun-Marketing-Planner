/**
 * Task Statuses Migration Script (Phase 0)
 *
 * Usage:
 *   npx ts-node scripts/migrateTaskStatuses.ts [--dry-run]
 *
 * This script:
 * 1. Seeds the canonical taskStatuses collection in Firestore.
 * 2. Scans all tasks in the tasks collection.
 * 3. Maps each task's legacy status to the corresponding taskStatus document.
 * 4. Updates each task with:
 *    - statusId (e.g. 'in-progress')
 *    - statusPhase ('not_started' | 'pending' | 'in_progress' | 'terminal')
 *    - isTerminal (boolean, true if phase is terminal)
 *    - status (normalized name, e.g. 'In Progress')
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';

interface CanonicalStatus {
  id: string;
  name: string;
  phase: 'not_started' | 'pending' | 'in_progress' | 'terminal';
  color: string;
  is_system: boolean;
}

const CANONICAL_STATUSES: CanonicalStatus[] = [
  // not_started
  { id: 'to-do', name: 'To Do', phase: 'not_started', color: '#6c757d', is_system: true },
  { id: 'backlog', name: 'Backlog', phase: 'not_started', color: '#495057', is_system: true },
  { id: 'draft', name: 'Draft', phase: 'not_started', color: '#adb5bd', is_system: true },
  { id: 'idea', name: 'Idea', phase: 'not_started', color: '#6c757d', is_system: true },
  { id: 'brief-needed', name: 'Brief Needed', phase: 'not_started', color: '#adb5bd', is_system: true },

  // pending
  { id: 'pending', name: 'Pending', phase: 'pending', color: '#f1c40f', is_system: true },
  { id: 'requested', name: 'Requested', phase: 'pending', color: '#f1c40f', is_system: true },
  { id: 'brief-sent', name: 'Brief Sent', phase: 'pending', color: '#adb5bd', is_system: true },
  { id: 'in-review', name: 'In Review', phase: 'pending', color: '#17a2b8', is_system: true },
  { id: 'draft-ready', name: 'Draft Ready', phase: 'pending', color: '#17a2b8', is_system: true },
  { id: 'awaiting-review', name: 'Awaiting Review', phase: 'pending', color: '#fd7e14', is_system: true },
  { id: 'blocked', name: 'Blocked', phase: 'pending', color: '#e74c3c', is_system: true },
  { id: 'submitted-for-review', name: 'Submitted for Review', phase: 'pending', color: '#e67e22', is_system: true },
  { id: 'revision-needed', name: 'Revision Needed', phase: 'pending', color: '#d35400', is_system: true },

  // in_progress
  { id: 'in-progress', name: 'In Progress', phase: 'in_progress', color: '#007bff', is_system: true },
  { id: 'approved', name: 'Approved', phase: 'in_progress', color: '#2ecc71', is_system: true },
  { id: 'scheduled', name: 'Scheduled', phase: 'in_progress', color: '#28a745', is_system: true },

  // terminal
  { id: 'completed', name: 'Completed', phase: 'terminal', color: '#28a745', is_system: true },
  { id: 'published', name: 'Published', phase: 'terminal', color: '#27ae60', is_system: true },
  { id: 'cancelled', name: 'Cancelled', phase: 'terminal', color: '#dc3545', is_system: true },
  { id: 'archived', name: 'Archived', phase: 'terminal', color: '#6c757d', is_system: true },
];

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('==================================================');
  console.log(`TASK STATUS MIGRATION - ${isDryRun ? 'DRY RUN' : 'LIVE RUN'}`);
  console.log('==================================================\n');

  // Fetch all tasks
  const tasksSnap = await db.collection('tasks').get();
  console.log(`Found ${tasksSnap.size} tasks in 'tasks' collection.`);

  const statusMap = new Map<string, CanonicalStatus>();
  for (const s of CANONICAL_STATUSES) {
    statusMap.set(s.name.toLowerCase().trim(), s);
  }

  const reports = {
    totalTasks: tasksSnap.size,
    mapped: 0,
    unmapped: 0,
    byPhase: {
      not_started: 0,
      pending: 0,
      in_progress: 0,
      terminal: 0,
    },
    statusCounts: {} as Record<string, number>,
    mappings: [] as { id: string; oldStatus: string; mappedTo: string; phase: string }[],
  };

  const tasksToUpdate: { ref: any; data: any }[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    const oldStatus = (task.status || '').trim();

    reports.statusCounts[oldStatus] = (reports.statusCounts[oldStatus] || 0) + 1;

    // Try to match
    let matched = statusMap.get(oldStatus.toLowerCase());
    if (!matched) {
      // Fallback mappings / normalizations
      const lower = oldStatus.toLowerCase();
      if (lower.includes('idea')) {
        matched = statusMap.get('idea');
      } else if (lower.includes('todo') || lower.includes('to do') || lower.includes('to_do')) {
        matched = statusMap.get('to do');
      } else if (lower.includes('in progress') || lower.includes('in_progress')) {
        matched = statusMap.get('in progress');
      } else {
        // Fallback to To Do (not_started)
        matched = statusMap.get('to do');
      }
    }

    if (matched) {
      reports.mapped++;
      reports.byPhase[matched.phase]++;
      reports.mappings.push({
        id: doc.id,
        oldStatus,
        mappedTo: matched.name,
        phase: matched.phase,
      });

      tasksToUpdate.push({
        ref: doc.ref,
        data: {
          statusId: matched.id,
          statusPhase: matched.phase,
          isTerminal: matched.phase === 'terminal',
          status: matched.name, // normalize status name
        },
      });
    } else {
      reports.unmapped++;
      console.warn(`WARNING: Task ${doc.id} has unmappable status "${oldStatus}". Defaulting to To Do.`);
    }
  }

  // Generate Report Output
  console.log('\n--- QA REPORT: STATUS DISTRIBUTION ---');
  for (const [statusName, count] of Object.entries(reports.statusCounts)) {
    console.log(`- "${statusName}": ${count} tasks`);
  }

  console.log('\n--- QA REPORT: TARGET PHASES ---');
  console.log(`- not_started: ${reports.byPhase.not_started}`);
  console.log(`- pending:     ${reports.byPhase.pending}`);
  console.log(`- in_progress: ${reports.byPhase.in_progress}`);
  console.log(`- terminal:    ${reports.byPhase.terminal}`);

  console.log(`\nSummary: Mapped ${reports.mapped} tasks successfully. Unmapped: ${reports.unmapped}.`);

  if (isDryRun) {
    console.log('\nDry run completed. No data was modified.');
    console.log('==================================================');
    return;
  }

  // Live Run - execute writes
  console.log('\nStarting database updates...');

  // 1. Seed taskStatuses
  console.log('Seeding taskStatuses collection...');
  const statusBatch = db.batch();
  for (const status of CANONICAL_STATUSES) {
    const docRef = db.collection('taskStatuses').doc(status.id);
    statusBatch.set(docRef, {
      id: status.id,
      name: status.name,
      phase: status.phase,
      color: status.color,
      is_system: status.is_system,
      created_at: new Date().toISOString(),
    });
  }
  await statusBatch.commit();
  console.log(`Seeded ${CANONICAL_STATUSES.length} canonical statuses.`);

  // 2. Update Tasks in batches of 500
  console.log(`Updating ${tasksToUpdate.length} tasks...`);
  const CHUNK_SIZE = 500;
  for (let i = 0; i < tasksToUpdate.length; i += CHUNK_SIZE) {
    const chunk = tasksToUpdate.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    for (const update of chunk) {
      batch.update(update.ref, update.data);
    }
    await batch.commit();
    console.log(`Updated tasks batch ${i / CHUNK_SIZE + 1} (${chunk.length} tasks).`);
  }

  console.log('\nLive migration completed successfully.');
  console.log('==================================================');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
