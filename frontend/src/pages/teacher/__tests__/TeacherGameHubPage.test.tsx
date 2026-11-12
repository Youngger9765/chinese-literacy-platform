/**
 * TeacherGameHubPage — issue #3633 teacher side.
 *
 * Gathers 跨班賽季／課堂搶答／班級內 PK settings into one 「遊戲區」 page:
 *  - links out to the existing management pages (/teacher/league,
 *    /teacher/live) rather than re-implementing their content
 *  - reuses <ClassroomPkSettingsPanel> (already battle-tested on
 *    ClassroomDetail.tsx) for the per-class switches, one per classroom —
 *    does NOT re-implement the switch logic
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'fake-token' }),
}));

const { listMyClassrooms } = vi.hoisted(() => ({
  listMyClassrooms: vi.fn(),
}));
vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return { ...actual, listMyClassrooms };
});

// ClassroomPkSettingsPanel already has its own full test coverage and owns
// its own save/error state (self-contained, see its own file header) — this
// page's job is only to reuse it per classroom, so stub it and assert props.
vi.mock('../ClassroomPkSettingsPanel', () => ({
  default: (props: {
    classroomId: number;
    pkHuman: boolean;
    league: boolean;
    liveQuiz: boolean;
  }) => (
    <div data-testid={`settings-panel-${props.classroomId}`}>
      pkHuman={String(props.pkHuman)} league={String(props.league)} liveQuiz={String(props.liveQuiz)}
    </div>
  ),
}));

import TeacherGameHubPage from '../TeacherGameHubPage';

function classroom(overrides: Partial<{
  id: number;
  name: string;
  pk_human: boolean;
  league: boolean;
  live_quiz: boolean;
}> = {}) {
  return {
    id: 1,
    name: '四年甲班',
    school_id: 1,
    teacher_id: 1,
    grade: 4,
    is_active: true,
    created_at: '2026-01-01',
    student_count: 10,
    pk_human: false,
    league: false,
    live_quiz: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  listMyClassrooms.mockReset();
});

describe('<TeacherGameHubPage> — links to the existing pages (#3633)', () => {
  it('clicking 跨班賽季 navigates to /teacher/league', async () => {
    listMyClassrooms.mockResolvedValue({ items: [], total: 0 });
    render(<TeacherGameHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /跨班賽季/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/teacher/league');
  });

  it('clicking 課堂搶答 navigates to /teacher/live', async () => {
    listMyClassrooms.mockResolvedValue({ items: [], total: 0 });
    render(<TeacherGameHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /課堂搶答/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/teacher/live');
  });

  it('has no 五人對抗賽／多人對抗賽 entry at all (#3632 v2: "老師端入口移除")', async () => {
    listMyClassrooms.mockResolvedValue({ items: [], total: 0 });
    render(<TeacherGameHubPage />);
    expect(screen.queryByRole('button', { name: /對抗賽/ })).toBeNull();
  });
});

describe('<TeacherGameHubPage> — per-class switches reuse <ClassroomPkSettingsPanel> (#3633)', () => {
  it('renders one settings panel per classroom with the right props (does not re-implement the switches)', async () => {
    listMyClassrooms.mockResolvedValue({
      items: [
        classroom({ id: 1, name: '四年甲班', pk_human: true, league: false, live_quiz: true }),
        classroom({ id: 2, name: '四年乙班' }),
      ],
      total: 2,
    });
    render(<TeacherGameHubPage />);
    await waitFor(() => expect(listMyClassrooms).toHaveBeenCalled());

    expect(screen.getByText('四年甲班')).toBeTruthy();
    expect(screen.getByText('四年乙班')).toBeTruthy();

    const panel1 = screen.getByTestId('settings-panel-1');
    expect(panel1.textContent).toContain('pkHuman=true');
    expect(panel1.textContent).toContain('league=false');
    expect(panel1.textContent).toContain('liveQuiz=true');

    const panel2 = screen.getByTestId('settings-panel-2');
    expect(panel2.textContent).toContain('pkHuman=false');
    expect(panel2.textContent).toContain('league=false');
    expect(panel2.textContent).toContain('liveQuiz=false');
  });

  it('shows a friendly empty state with zero classrooms (does not crash)', async () => {
    listMyClassrooms.mockResolvedValue({ items: [], total: 0 });
    render(<TeacherGameHubPage />);
    await waitFor(() => expect(listMyClassrooms).toHaveBeenCalled());
    expect(screen.getByText('還沒有建立班級')).toBeTruthy();
  });
});

describe('<TeacherGameHubPage> — resilience (render smoke)', () => {
  it('does not throw while the classroom list is still loading', () => {
    listMyClassrooms.mockReturnValue(new Promise(() => {}));
    expect(() => render(<TeacherGameHubPage />)).not.toThrow();
  });

  it('shows an error message instead of crashing when the fetch fails', async () => {
    listMyClassrooms.mockRejectedValue(new Error('network error'));
    render(<TeacherGameHubPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
