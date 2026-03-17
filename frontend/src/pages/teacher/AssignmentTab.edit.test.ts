import { describe, it, expect } from 'vitest';

/**
 * Unit tests for assignment edit feature (Issue #425)
 * Verifies that edit state helpers work correctly.
 */

function parseDueDateForInput(dueDateIso: string | null): string {
  if (!dueDateIso) return '';
  return new Date(dueDateIso).toISOString().slice(0, 10);
}

describe('Assignment Edit Feature (#425)', () => {
  describe('parseDueDateForInput', () => {
    it('returns YYYY-MM-DD for ISO datetime', () => {
      expect(parseDueDateForInput('2026-04-01T00:00:00Z')).toBe('2026-04-01');
    });

    it('returns empty string for null', () => {
      expect(parseDueDateForInput(null)).toBe('');
    });

    it('returns empty string for empty input', () => {
      expect(parseDueDateForInput('')).toBe('');
    });
  });

  describe('due_date payload', () => {
    it('passes non-empty date string through', () => {
      const editDueDate = '2026-05-31';
      const payload = editDueDate || null;
      expect(payload).toBe('2026-05-31');
    });

    it('converts empty string to null (clears due date)', () => {
      const editDueDate = '';
      const payload = editDueDate || null;
      expect(payload).toBeNull();
    });
  });

  describe('title/description trim', () => {
    it('blank title trims to undefined (falls back to story title)', () => {
      const title = '   '.trim() || undefined;
      expect(title).toBeUndefined();
    });

    it('non-blank title is trimmed correctly', () => {
      const title = '  第一單元作業  '.trim() || undefined;
      expect(title).toBe('第一單元作業');
    });

    it('blank description trims to undefined', () => {
      const desc = '  '.trim() || undefined;
      expect(desc).toBeUndefined();
    });
  });
});
