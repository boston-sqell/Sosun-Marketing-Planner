/**
 * Marketing Planner — template helpers (pure bits).
 *
 * A template is a frozen work-item tree (root + subtasks + field defaults +
 * relative due dates). Instantiation itself lives in data.ts (it resolves each
 * node's type → workflow → initialStatus and writes docs); the pure, testable
 * piece is turning a relative `dueInDays` into an absolute date.
 */

/** now + dueInDays as a YYYY-MM-DD date, or null when dueInDays is unset. */
export function computeDueDate(now: string, dueInDays?: number): string | null {
  if (dueInDays === undefined || dueInDays === null) return null;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + dueInDays);
  return d.toISOString().slice(0, 10);
}
