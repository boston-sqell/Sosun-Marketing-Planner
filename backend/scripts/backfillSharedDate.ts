/**
 * One-time, idempotent migration: reviewDeadline → sharedDate
 *
 * Background:
 *   The `reviewDeadline` field on task documents was renamed to `sharedDate`
 *   to reflect that it records the factual date a draft was shared for review,
 *   not a deadline that should trigger automatic overdue alerts.
 *
 * What this script does:
 *   For every task that has `reviewDeadline` set but no `sharedDate` yet,
 *   it copies the value into `sharedDate` and leaves `reviewDeadline` in place
 *   (so old clients / exports keep working). Run it once after deploying the
 *   frontend update.
 *
 * Run from backend/:
 *   npx ts-node scripts/backfillSharedDate.ts
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in .env or Application Default Credentials.
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';

async function main() {
  const snap = await db.collection('tasks').get();
  console.log(`Found ${snap.size} task(s) total.`);

  let updated = 0;
  let skipped = 0;
  let noDate = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // Already migrated — skip
    if (data.sharedDate) {
      skipped++;
      continue;
    }

    // No legacy date to migrate
    if (!data.reviewDeadline) {
      noDate++;
      continue;
    }

    await docSnap.ref.update({ sharedDate: data.reviewDeadline });
    console.log(`+ ${docSnap.id}: reviewDeadline "${data.reviewDeadline}" → sharedDate`);
    updated++;
  }

  console.log(`\nDone.`);
  console.log(`  Migrated : ${updated}`);
  console.log(`  Already had sharedDate (skipped): ${skipped}`);
  console.log(`  No date field at all: ${noDate}`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
