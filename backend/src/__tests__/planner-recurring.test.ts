import { describe, it, expect } from 'vitest';
import { matchesCron } from '../lib/planner/data';

describe('matchesCron', () => {
  it('matches wildcard expressions', () => {
    const d = new Date(2026, 6, 3, 10, 45, 0); // Friday July 3 2026, 10:45 local
    expect(matchesCron('* * * * *', d)).toBe(true);
  });

  it('matches exact minute and hour', () => {
    const d = new Date(2026, 6, 3, 10, 45, 0);
    expect(matchesCron('45 10 * * *', d)).toBe(true);
    expect(matchesCron('46 10 * * *', d)).toBe(false);
    expect(matchesCron('45 11 * * *', d)).toBe(false);
  });

  it('matches day of week', () => {
    const d = new Date(2026, 6, 3, 10, 45, 0); // July 3, 2026 is a Friday (5)
    expect(matchesCron('* * * * 5', d)).toBe(true);
    expect(matchesCron('* * * * 4', d)).toBe(false);
  });

  it('matches list expressions', () => {
    const d = new Date(2026, 6, 3, 10, 45, 0);
    expect(matchesCron('40,45,50 * * * *', d)).toBe(true);
    expect(matchesCron('40,46,50 * * * *', d)).toBe(false);
  });

  it('matches range expressions', () => {
    const d = new Date(2026, 6, 3, 10, 45, 0);
    expect(matchesCron('40-50 10 * * *', d)).toBe(true);
    expect(matchesCron('46-50 10 * * *', d)).toBe(false);
  });

  it('matches steps expressions', () => {
    const d = new Date(2026, 6, 3, 10, 45, 0);
    expect(matchesCron('*/5 10 * * *', d)).toBe(true);
    expect(matchesCron('*/10 10 * * *', d)).toBe(false);
  });
});
