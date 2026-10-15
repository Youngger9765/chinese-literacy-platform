import { describe, it, expect } from 'vitest';
import { invitationStatusLabel } from '../TeacherLeaguePage';

describe('invitationStatusLabel', () => {
  it('every backend invitation status has a Chinese label (no raw English shown to teachers)', () => {
    // backend/app/models/league.py INVITATION_* constants
    for (const s of ['pending', 'accepted', 'declined', 'expired', 'revoked']) {
      expect(invitationStatusLabel(s)).not.toBe(s);
      expect(invitationStatusLabel(s)).toMatch(/[一-鿿]/);
    }
  });
});
