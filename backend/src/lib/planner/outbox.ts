/**
 * Marketing Planner — transactional outbox (spec-revisions §14.3, open item #1).
 *
 * The atomicity fix for side effects. Instead of firing notify/webhook/
 * createWorkItems/automations/follow-on-transitions *after* a commit (where a
 * crash loses them), producers enqueue an outbox job IN THE SAME TRANSACTION as
 * the state change. A Cloud Scheduler → authenticated endpoint drains pending
 * jobs (drainOutbox in data.ts), with exponential backoff and a max-attempts
 * cap. This makes effects durable and at-least-once.
 *
 * This module holds the job shapes, the enqueue helper (takes the caller's
 * transaction), and the pure backoff math. The drainer lives in data.ts because
 * it needs the executors (which would be a circular import here).
 */

import { firestore } from 'firebase-admin';
import { PostFunction, AutomationEvent } from './types';

export const OUTBOX_COLLECTION = 'plannerOutbox';
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 3600;

/** A unit of deferred work. Carries everything needed to run it standalone. */
export type OutboxJob =
  | { type: 'asyncOps'; itemId: string; ops: PostFunction[]; actorUid: string; roles: string[]; depth: number }
  | { type: 'automations'; event: AutomationEvent; itemId: string; actorUid: string; roles: string[]; depth: number }
  | { type: 'transition'; itemId: string; transitionId: string; actorUid: string; roles: string[]; system: boolean; depth: number };

export interface OutboxRecord {
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  job: OutboxJob;
}

/** Exponential backoff (seconds) for the Nth attempt: 60, 120, 240, … capped. */
export function backoffSeconds(attempts: number): number {
  const delay = BACKOFF_BASE_SECONDS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(delay, BACKOFF_MAX_SECONDS);
}

/** now (ISO) + seconds, as an ISO string. */
export function addSeconds(nowIso: string, seconds: number): string {
  return new Date(new Date(nowIso).getTime() + seconds * 1000).toISOString();
}

/**
 * Enqueue a job within the caller's transaction. Because it's the same
 * transaction as the state mutation, the job is durably recorded iff the state
 * change commits — no lost side effects, no orphan jobs.
 */
export function enqueue(
  tx: firestore.Transaction,
  db: firestore.Firestore,
  job: OutboxJob,
  now: string,
): void {
  const ref = db.collection(OUTBOX_COLLECTION).doc();
  const record: OutboxRecord = {
    status: 'pending',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    job,
  };
  tx.set(ref, record);
}
