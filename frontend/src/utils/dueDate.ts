/**
 * Due dates mean "the whole day, Taiwan time".
 *
 * The date picker sends 「2026-10-13」 and the API stores 2026-10-13T00:00:00Z,
 * i.e. 10/13 08:00 in Taiwan. Comparing that instant with "now" marked work
 * 逾期 from 8 a.m. on its own due day. Every overdue check goes through here.
 */
const TW_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 23:59:59.999 Taiwan time on the due date's Taiwan calendar day. */
export function dueDeadline(due: string): Date {
  const tw = new Date(new Date(due).getTime() + TW_OFFSET_MS);
  const endOfDayTwAsUtc = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate(), 23, 59, 59, 999);
  return new Date(endOfDayTwAsUtc - TW_OFFSET_MS);
}

export function isPastDue(due: string | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false;
  return now.getTime() > dueDeadline(due).getTime();
}
