/**
 * One-time, idempotent backfill of `createdAt` on tasks.
 *
 * The Tasks & Queue view now orders by `createdAt desc`. Firestore's orderBy
 * EXCLUDES documents that lack the field, so legacy tasks would disappear
 * from the list until this script is run once.
 *
 * For each task missing `createdAt`, sets it to the document's Firestore
 * creation timestamp (doc.createTime) as an ISO string — matching the
 * convention used by Brands/Budget/Events.
 *
 * Run from backend/:  npx ts-node scripts/backfillTaskCreatedAt.ts
 * Requires FIREBASE_SERVICE_ACCOUNT in .env or Application Default Credentials.
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/services/firestore';

async function main() {
  const snap = await db.collection('tasks').get();
  console.log(`Found ${snap.size} tasks.`);

  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    if (doc.data().createdAt) {
      skipped++;
      continue;
    }
    const createdAt = doc.createTime.toDate().toISOString();
    await doc.ref.update({ createdAt });
    console.log(`+ backfilled ${doc.id} -> ${createdAt}`);
    updated++;
  }

  console.log(`Done. Updated ${updated}, already had createdAt: ${skipped}.`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
