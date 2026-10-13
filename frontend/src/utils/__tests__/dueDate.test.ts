import { describe, it, expect } from 'vitest';
import { isPastDue, dueDeadline } from '../dueDate';

// A teacher picks 「10/13」 in the date picker; the API stores
// 2026-10-13T00:00:00Z, which is 10/13 08:00 in Taiwan. Comparing that instant
// with "now" turned the assignment 逾期 at 8 a.m. on its own due day
// (reproduced on staging 2026-10-13). A due date means the whole day, Taiwan time.
const tw = (iso: string) => new Date(`${iso}+08:00`);

describe('isPastDue — a due date means until the end of that day in Taiwan', () => {
  const picked = '2026-10-13T00:00:00Z';

  it('is not overdue during the due day (08:00, noon, 23:59 TW)', () => {
    expect(isPastDue(picked, tw('2026-10-13T08:00:01'))).toBe(false);
    expect(isPastDue(picked, tw('2026-10-13T12:00:00'))).toBe(false);
    expect(isPastDue(picked, tw('2026-10-13T23:59:59'))).toBe(false);
  });

  it('is overdue from the next day 00:00 TW', () => {
    expect(isPastDue(picked, tw('2026-10-14T00:00:00'))).toBe(true);
  });

  it('a due timestamp with a time of day uses its Taiwan date', () => {
    // 2026-09-23T03:27Z is 9/23 11:27 in Taiwan -> due all of 9/23
    expect(isPastDue('2026-09-23T03:27:05Z', tw('2026-09-23T20:00:00'))).toBe(false);
    expect(isPastDue('2026-09-23T03:27:05Z', tw('2026-09-24T00:00:01'))).toBe(true);
  });

  it('no due date is never overdue', () => {
    expect(isPastDue(null, tw('2030-01-01T00:00:00'))).toBe(false);
    expect(isPastDue(undefined)).toBe(false);
  });

  it('dueDeadline is 23:59:59.999 Taiwan on the due day', () => {
    expect(dueDeadline(picked).toISOString()).toBe('2026-10-13T15:59:59.999Z');
  });
});
