/**
 * Marketing Planner — activity audit writer (spec §11).
 *
 * The audit stream is the source of truth for reports, dashboards and "what
 * happened to this campaign". To keep the immutability guarantee, entries are
 * written ONLY here, through the Admin SDK, and always inside the same
 * transaction as the mutation they record. They are never updated or deleted.
 *
 * Firestore rules make `activity` create/update/delete `false` for clients
 * (see docs/planner/spec-revisions.md §1.3) — this is the only writer.
 */

import { firestore } from 'firebase-admin';
import { ActivityEntry } from './types';
import { WORK_ITEMS_COLLECTION } from './constants';

/**
 * Append an activity entry to a work item's `activity` subcollection within an
 * existing transaction. The caller owns the transaction so the audit write
 * commits atomically with the state change.
 */
export function appendActivity(
  tx: firestore.Transaction,
  db: firestore.Firestore,
  itemId: string,
  entry: ActivityEntry,
): void {
  const ref = db.collection(WORK_ITEMS_COLLECTION).doc(itemId).collection('activity').doc();
  tx.set(ref, entry);
}
