/**
 * Behavioral replacement for part of worksheetButton2845.test.ts's coverage (#3276).
 *
 * That file's static regex checks ("no string matching teacher[-_]?edition
 * appears in Intro.tsx") were written for a world where a teacher edition
 * should NEVER exist in this file at all — any appearance was necessarily a
 * leak. #3276 makes a teacher edition a deliberate, role-gated feature, so a
 * regex banning the word is no longer the right tool: it would either false
 * -positive on legitimate code, or (worse, and what actually happened when
 * this file was first written) silently stop testing anything meaningful
 * because the new code's naming doesn't happen to match the old pattern.
 *
 * The real invariant now is behavioral: a student-role user must never be
 * able to render or trigger a download of the teacher edition, no matter
 * what the button is called. This file renders the real component under
 * different roles and asserts on the DOM + the actual download call, not on
 * source text.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ zhuyinActive: false, processZhuyin: (text: string) => text }),
}));

const mockUseAuth = vi.fn();
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../../services/omoApi', () => ({
  getPriorOmoUploadByLesson: vi.fn().mockResolvedValue({ has_prior_upload: false }),
  getOmoImageSignedUrl: vi.fn(),
}));

vi.mock('../../../hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }));

vi.mock('../../../config/stepConfig', () => ({
  resolveActiveSteps: () => [{ id: 'full-text-annotate', label: '做記號' }],
}));

const mockDownloadAuthenticatedFile = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../utils/downloadRemoteFile', () => ({
  downloadAuthenticatedFile: (...args: unknown[]) => mockDownloadAuthenticatedFile(...args),
}));

import Intro from '../Intro';
import { Story } from '../../../types';
import type { AuthUser } from '../../../services/authApi';

function authUserWithRoles(...roleNames: string[]): AuthUser {
  return {
    id: 1,
    email: 'x@test.com',
    name: 'x',
    is_active: true,
    onboarding_completed: true,
    roles: roleNames.map((role_name) => ({
      role_name,
      role_display_name: role_name,
      scope_type: 'platform',
      scope_id: null,
    })),
    terms_accepted: true,
    terms_accepted_at: null,
    terms_version: null,
    has_classroom: true,
    teacher_gating_enforced: false,
  };
}

const storyBothAvailable: Story = {
  id: 'L01',
  title: '測試課文',
  level: '3',
  content: ['課文段落一'],
  thumbnail: '/test.jpg',
  category: 'Fable',
  filename: 'L01.yml',
  vocabulary: [],
  lessonUid: 'L0001',
  lesson_code: 'G4-L1',
  worksheetAvailable: { student: true, teacher: true },
};

beforeEach(() => {
  mockDownloadAuthenticatedFile.mockClear();
});

describe('#3276 學習單下載角色分權 — student role', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ token: 'student-token', user: authUserWithRoles('student') });
  });

  it('shows the student edition button', () => {
    render(<Intro story={storyBothAvailable} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: '下載學生版學習單' })).toBeInTheDocument();
  });

  it('does NOT render a teacher edition button anywhere in the DOM', () => {
    render(<Intro story={storyBothAvailable} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '下載教師版學習單' })).toBeNull();
  });

  it('clicking the student button downloads the STUDENT endpoint, never teacher', async () => {
    render(<Intro story={storyBothAvailable} onStartReading={vi.fn()} onBack={vi.fn()} />);
    screen.getByRole('button', { name: '下載學生版學習單' }).click();
    await Promise.resolve();
    expect(mockDownloadAuthenticatedFile).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockDownloadAuthenticatedFile.mock.calls[0];
    expect(calledUrl).toContain('/worksheet/student');
    expect(calledUrl).not.toContain('/worksheet/teacher');
  });
});

describe('#3276 學習單下載角色分權 — teacher role', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ token: 'teacher-token', user: authUserWithRoles('teacher') });
  });

  it('shows BOTH student and teacher edition buttons ("老師身份都可以看到跟下載")', () => {
    render(<Intro story={storyBothAvailable} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: '下載學生版學習單' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下載教師版學習單' })).toBeInTheDocument();
  });

  it('clicking the teacher button downloads the TEACHER endpoint', async () => {
    render(<Intro story={storyBothAvailable} onStartReading={vi.fn()} onBack={vi.fn()} />);
    screen.getByRole('button', { name: '下載教師版學習單' }).click();
    await Promise.resolve();
    const teacherCall = mockDownloadAuthenticatedFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('/worksheet/teacher'),
    );
    expect(teacherCall).toBeDefined();
  });
});

describe('#3276 學習單下載角色分權 — 其他非教師角色（parent）也不該看到教師版', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ token: 'parent-token', user: authUserWithRoles('parent') });
  });

  it('parent role does not get the teacher button either (allow-list, not "just exclude student")', () => {
    render(<Intro story={storyBothAvailable} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '下載教師版學習單' })).toBeNull();
  });
});

describe('#3276 學習單下載角色分權 — 沒有教師版檔案時', () => {
  it('a teacher-role user does not see a teacher button for a lesson with no teacher edition uploaded (#2845 dead-button lesson)', () => {
    mockUseAuth.mockReturnValue({ token: 'teacher-token', user: authUserWithRoles('teacher') });
    const storyStudentOnly: Story = { ...storyBothAvailable, worksheetAvailable: { student: true, teacher: false } };
    render(<Intro story={storyStudentOnly} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '下載教師版學習單' })).toBeNull();
    expect(screen.getByRole('button', { name: '下載學生版學習單' })).toBeInTheDocument();
  });

  it('no buttons at all when neither edition is uploaded yet', () => {
    mockUseAuth.mockReturnValue({ token: 'teacher-token', user: authUserWithRoles('teacher') });
    const storyNone: Story = { ...storyBothAvailable, worksheetAvailable: { student: false, teacher: false } };
    render(<Intro story={storyNone} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '下載學生版學習單' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下載教師版學習單' })).toBeNull();
  });
});
