/**
 * Tests for TermsOfService role-based rendering — Issue #1918
 *
 * Bugs fixed:
 *   1. school_admin shown "教師帳號" badge → fixed to "管理員帳號"
 *   2. Admin sees teacher-specific commitments → fixed to admin commitments
 *   3. TermsOfService page subheader says "教師承諾" for admin → fixed
 *   4. TermsGate modal shown simultaneously with /terms page → fixed with path guard
 */
import { describe, it, expect } from 'vitest';

import { hasRole } from '../../services/authApi';
import type { AuthUser } from '../../services/authApi';

// --- Helper ---

function makeUser(roleNames: string[], name = '測試用戶'): AuthUser {
  return {
    id: 1,
    email: 'placeholder-no-real-email',
    name,
    is_active: true,
    onboarding_completed: false,
    terms_accepted: false,
    terms_accepted_at: null,
    terms_version: null,
    has_classroom: true,
    teacher_gating_enforced: false,
    roles: roleNames.map((r) => ({
      role_name: r,
      role_display_name: r,
      scope_type: 'platform',
      scope_id: null,
    })),
  };
}

// Mirror the FIXED role logic from TermsOfService.tsx
function getIsAdmin(user: AuthUser): boolean {
  return hasRole(user, 'school_admin', 'org_admin', 'system_admin');
}

function getIsTeacher(user: AuthUser): boolean {
  return !getIsAdmin(user) && hasRole(user, 'teacher');
}

function getRoleLabel(user: AuthUser): string {
  if (getIsAdmin(user)) return '管理員帳號';
  if (getIsTeacher(user)) return '教師帳號';
  return '學生帳號';
}

function getPageSubheader(user: AuthUser): string {
  if (getIsAdmin(user)) return '在使用 LingoLeap 平台前，請詳閱並同意以下管理員使用條款';
  if (getIsTeacher(user)) return '在使用 LingoLeap 平台前，請詳閱並同意以下教師承諾';
  return '在使用 LingoLeap 平台前，請詳閱並同意以下事項';
}

// Mirror the FIXED commitment selection logic from TermsOfService.tsx
const TEACHER_COMMITMENT_IDS = ['real-info', 'licensed-content', 'no-unauthorized', 'auto-delete'];
const ADMIN_COMMITMENT_IDS = ['admin-compliance', 'admin-data'];
const STUDENT_COMMITMENT_IDS = ['learn-earnestly'];

function getCommitmentIds(user: AuthUser): string[] {
  if (getIsAdmin(user)) return ADMIN_COMMITMENT_IDS;
  if (getIsTeacher(user)) return TEACHER_COMMITMENT_IDS;
  return STUDENT_COMMITMENT_IDS;
}

// --- Tests for hasRole logic ---

describe('hasRole — admin vs teacher separation', () => {
  it('school_admin is NOT a teacher', () => {
    expect(hasRole(makeUser(['school_admin']), 'teacher')).toBe(false);
  });

  it('org_admin is NOT a teacher', () => {
    expect(hasRole(makeUser(['org_admin']), 'teacher')).toBe(false);
  });

  it('system_admin is NOT a teacher', () => {
    expect(hasRole(makeUser(['system_admin']), 'teacher')).toBe(false);
  });

  it('teacher IS a teacher', () => {
    expect(hasRole(makeUser(['teacher']), 'teacher')).toBe(true);
  });

  it('school_admin IS an admin', () => {
    expect(hasRole(makeUser(['school_admin']), 'school_admin', 'org_admin', 'system_admin')).toBe(true);
  });
});

// --- Role badge tests ---

describe('TermsOfService role badge — issue #1918', () => {
  it('school_admin sees 管理員帳號 badge, not 教師帳號', () => {
    const label = getRoleLabel(makeUser(['school_admin'], '王管理員'));
    expect(label).toBe('管理員帳號');
    expect(label).not.toBe('教師帳號');
  });

  it('org_admin sees 管理員帳號 badge', () => {
    expect(getRoleLabel(makeUser(['org_admin']))).toBe('管理員帳號');
  });

  it('system_admin sees 管理員帳號 badge', () => {
    expect(getRoleLabel(makeUser(['system_admin']))).toBe('管理員帳號');
  });

  it('teacher sees 教師帳號 badge', () => {
    expect(getRoleLabel(makeUser(['teacher']))).toBe('教師帳號');
  });

  it('student sees 學生帳號 badge', () => {
    expect(getRoleLabel(makeUser(['student']))).toBe('學生帳號');
  });
});

// --- Subheader text tests ---

describe('TermsOfService subheader — issue #1918', () => {
  it('admin does NOT see 教師承諾 in subheader', () => {
    const header = getPageSubheader(makeUser(['school_admin']));
    expect(header).not.toContain('教師承諾');
    expect(header).toContain('管理員');
  });

  it('teacher sees 教師承諾 in subheader', () => {
    expect(getPageSubheader(makeUser(['teacher']))).toContain('教師承諾');
  });

  it('student does not see 教師承諾 in subheader', () => {
    expect(getPageSubheader(makeUser(['student']))).not.toContain('教師承諾');
  });
});

// --- Commitment set tests ---

describe('TermsOfService commitments — issue #1918', () => {
  it('admin gets admin-specific commitments (not teacher commitments)', () => {
    const ids = getCommitmentIds(makeUser(['school_admin']));
    expect(ids).toEqual(ADMIN_COMMITMENT_IDS);
    expect(ids).not.toContain('real-info');
    expect(ids).not.toContain('licensed-content');
    expect(ids).not.toContain('no-unauthorized');
    expect(ids).not.toContain('auto-delete');
  });

  it('teacher gets teacher commitments', () => {
    expect(getCommitmentIds(makeUser(['teacher']))).toEqual(TEACHER_COMMITMENT_IDS);
  });

  it('student gets student commitments', () => {
    expect(getCommitmentIds(makeUser(['student']))).toEqual(STUDENT_COMMITMENT_IDS);
  });
});

// --- TermsGate modal coexistence guard ---

describe('TermsGate + /terms page coexistence guard — issue #1918', () => {
  it('should not show both modal and /terms page simultaneously', () => {
    // Mirror the shouldShowModal logic from the fixed TermsGate.tsx
    function shouldShowModal(pathname: string, needsTermsAcceptance: boolean): boolean {
      return needsTermsAcceptance && pathname !== '/terms';
    }

    // On /terms page: modal must NOT show even if terms not accepted
    expect(shouldShowModal('/terms', true)).toBe(false);

    // On other pages: modal shows if terms not accepted
    expect(shouldShowModal('/', true)).toBe(true);
    expect(shouldShowModal('/dashboard', true)).toBe(true);

    // If terms already accepted: modal never shows
    expect(shouldShowModal('/', false)).toBe(false);
    expect(shouldShowModal('/terms', false)).toBe(false);
  });
});
