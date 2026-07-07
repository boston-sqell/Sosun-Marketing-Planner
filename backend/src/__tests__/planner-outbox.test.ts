import { describe, it, expect } from 'vitest';
import { backoffSeconds, addSeconds } from '../lib/planner/outbox';

/*
 * Unit tests for the pure outbox backoff math. The drainer itself is
 * Firestore-bound and covered by integration testing.
 */

describe('backoffSeconds', () => {
  it('is exponential from a 60s base', () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(3)).toBe(240);
    expect(backoffSeconds(4)).toBe(480);
  });

  it('caps at 3600s', () => {
    expect(backoffSeconds(10)).toBe(3600);
    expect(backoffSeconds(100)).toBe(3600);
  });

  it('never goes below the base for the first attempt', () => {
    expect(backoffSeconds(0)).toBe(60);
    expect(backoffSeconds(1)).toBe(60);
  });
});

describe('addSeconds', () => {
  it('adds seconds and returns an ISO string', () => {
    expect(addSeconds('2026-07-02T10:00:00.000Z', 60)).toBe('2026-07-02T10:01:00.000Z');
    expect(addSeconds('2026-07-02T10:00:00.000Z', 3600)).toBe('2026-07-02T11:00:00.000Z');
  });
});
