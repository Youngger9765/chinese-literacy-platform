/**
 * issue #3632 — ClassroomDetail.tsx is the SECOND consumer of
 * <ClassroomPkSettingsPanel> (the first is TeacherGameHubPage.tsx, already
 * covered by its own test). This page must also forward the real
 * `classroom.team_arena` value through as the panel's `teamArena` prop —
 * leaving it unwired would silently show the switch as always-off
 * regardless of the classroom's actual stored setting (the panel's
 * `teamArena` prop defaults to `false` for backward compat, which hides
 * this exact mistake instead of crashing).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClassroomDetail from '../ClassroomDetail';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'teacher' } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  getClassroomDetail: vi.fn(() => new Promise(() => {})),
  updateClassroom: vi.fn(),
  addStudent: vi.fn(),
  removeStudent: vi.fn(),
  exportClassroomReport: vi.fn(),
  regenerateClassroomCode: vi.fn(),
  deleteClassroom: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

vi.mock('../StudentProgressTab', () => ({ default: () => <div data-testid="student-progress-tab" /> }));
vi.mock('../TextManagementTab', () => ({ default: () => <div data-testid="text-management-tab" /> }));
vi.mock('../StudentListTab', () => ({ default: () => <div data-testid="student-list-tab" /> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div data-testid="classroom-analytics" /> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div data-testid="cross-text-analytics" /> }));
vi.mock('../../components/teacher/AtRiskStudents', () => ({ default: () => <div data-testid="at-risk-students" /> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div data-testid="error-heatmap-tab" /> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div data-testid="co-teaching-tab" /> }));
vi.mock('../panel/TodayOverviewTab', () => ({ default: () => <div data-testid="today-overview-tab" /> }));
vi.mock('../panel/AssignmentsPanel', () => ({ default: () => <div data-testid="assignments-panel" /> }));
vi.mock('../panel/ClassSwitcher', () => ({ default: () => null }));
vi.mock('../panel/ClassListSidebar', () => ({ default: () => null }));
vi.mock('../panel/StudentsPanel', () => ({ default: () => <div data-testid="students-panel" /> }));

// ClassroomPkSettingsPanel already has its own full test coverage (see
// ClassroomPkSettingsPanel.*.test.tsx) — this page's only job is to forward
// the right props, so stub it and assert what it received.
vi.mock('../ClassroomPkSettingsPanel', () => ({
  default: (props: { pkHuman: boolean; league: boolean; liveQuiz: boolean; teamArena?: boolean }) => (
    <div data-testid="settings-panel">
      pkHuman={String(props.pkHuman)} league={String(props.league)} liveQuiz={String(props.liveQuiz)}{' '}
      teamArena={String(props.teamArena)}
    </div>
  ),
}));

function classroom(overrides: Partial<ClassroomDetailResponse> = {}): ClassroomDetailResponse {
  return {
    id: 99,
    name: 'QA 測試班',
    school_id: 1,
    teacher_id: 1,
    grade: 5,
    is_active: true,
    created_at: '2026-10-11T00:00:00Z',
    student_count: 0,
    pk_human: false,
    league: false,
    live_quiz: false,
    team_arena: false,
    students: [],
    ...overrides,
  };
}

describe('ClassroomDetail forwards team_arena to <ClassroomPkSettingsPanel> (#3632)', () => {
  it('passes teamArena=true through when the classroom has team_arena=true', () => {
    render(
      <MemoryRouter initialEntries={['/teacher/classroom/99']}>
        <ClassroomDetail classroomId={99} onBack={vi.fn()} initialClassroom={classroom({ team_arena: true })} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('settings-panel').textContent).toContain('teamArena=true');
  });

  it('passes teamArena=false through when the classroom has team_arena=false', () => {
    render(
      <MemoryRouter initialEntries={['/teacher/classroom/99']}>
        <ClassroomDetail classroomId={99} onBack={vi.fn()} initialClassroom={classroom({ team_arena: false })} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('settings-panel').textContent).toContain('teamArena=false');
  });
});
