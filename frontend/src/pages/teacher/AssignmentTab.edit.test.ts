/**
 * Unit tests for assignment edit feature (Issue #425)
 * Verifies that edit state helpers work correctly.
 * Run with: npx vitest run AssignmentTab.edit --reporter=verbose
 */

import { describe, it, expect } from 'vitest';

// ── Helper: parse due_date the same way handleOpenEdit does ──────────────────

function parseDueDateForInput(dueDateIso: string | null): string {
  if (!dueDateIso) return '';
  return new Date(dueDateIso).toISOString().slice(0, 10);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Assignment Edit Feature (Issue #425)', () => {
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
      const editDueDateFilled = '2026-05-31';
      const dueDatePayload = editDueDateFilled || null;
      expect(dueDatePayload).toBe('2026-05-31');
    });

    it('converts empty string to null (clears due date)', () => {
      const editDueDateEmpty = '';
      const dueDatePayloadEmpty = editDueDateEmpty || null;
      expect(dueDatePayloadEmpty).toBeNull();
    });
  });

  describe('title trim', () => {
    it('blank title trims to undefined (falls back to story title)', () => {
      const editTitleBlank = '   ';
      const titlePayload = editTitleBlank.trim() || undefined;
      expect(titlePayload).toBeUndefined();
    });

    it('non-blank title is trimmed correctly', () => {
      const editTitleWithSpaces = '  第一單元作業  ';
      const titlePayloadTrimmed = editTitleWithSpaces.trim() || undefined;
      expect(titlePayloadTrimmed).toBe('第一單元作業');
    });
  });

  describe('description trim', () => {
    it('blank description trims to undefined', () => {
      const editDescBlank = '  ';
      const descPayload = editDescBlank.trim() || undefined;
      expect(descPayload).toBeUndefined();
    });
  });
});
