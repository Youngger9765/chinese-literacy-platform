import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import StudentsPanel, { summarizeStudents } from './StudentsPanel';
import * as api from '../../../services/teacherApi';

// AnswerRecordLink (Issue #3682) renders a react-router <Link> — every test
// that mounts StudentsPanel/StudentDetail needs a router context for it.
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

const matrix: api.AssignmentMatrixResponse = {
  students: [{ id: 1, name: '王小明' }, { id: 2, name: '林雨萱' }],
  assignments: [{ id: 10, title: '甲', due_date: null }, { id: 11, title: '乙', due_date: null }],
  cells: [
    { student_id: 1, assignment_id: 10, state: 'completed', score: 80, current_step: null },
    { student_id: 1, assignment_id: 11, state: 'completed', score: 91, current_step: null },
    { student_id: 2, assignment_id: 10, state: 'in_progress', score: null, current_step: null },
    { student_id: 2, assignment_id: 11, state: 'not_assigned', score: null, current_step: null },
  ],
};

describe('學生分頁 (#3376)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getAssignmentMatrix').mockResolvedValue(matrix);
    vi.spyOn(api, 'getStudentAssignments').mockResolvedValue({
      student_id: 1,
      student_name: '王小明',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null,
        reading_accuracy: 96, comprehension: null, vocab: 80, error_chars: ['喝', '采'], session_id: 501,
      }],
    });
  });

  it('summarizes submitted / assigned and the average, ignoring not-assigned', () => {
    expect(summarizeStudents(matrix)).toEqual([
      { id: 1, name: '王小明', submitted: 2, assigned: 2, average: 86 },
      { id: 2, name: '林雨萱', submitted: 0, assigned: 1, average: null },
    ]);
  });

  it('clicking a name asks to open that student', async () => {
    const onSelect = vi.fn();
    render(<StudentsPanel classroomId={9} selectedStudentId={null} onSelectStudent={onSelect} />);
    const desktopTable = await screen.findByRole('table', { name: '學生名單' });
    await userEvent.click(within(desktopTable).getByRole('button', { name: '王小明' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('renders mobile summary cards alongside the desktop student table', async () => {
    render(<StudentsPanel classroomId={9} selectedStudentId={null} onSelectStudent={vi.fn()} />);

    const mobileList = await screen.findByRole('list', { name: '學生名單（手機）' });
    const desktopTable = screen.getByRole('table', { name: '學生名單' });

    expect(mobileList).toHaveClass('sm:hidden');
    expect(desktopTable).toHaveClass('hidden', 'sm:table');
    expect(within(mobileList).getAllByRole('listitem')).toHaveLength(2);
    expect(mobileList).toHaveTextContent('已交作業 2 / 2');
    expect(mobileList).toHaveTextContent('平均分數 86');
    expect(mobileList).toHaveTextContent('已交作業 0 / 1');
    expect(mobileList).toHaveTextContent('平均分數 —');
  });

  it('clicking a name in a mobile summary card asks to open that student', async () => {
    const onSelect = vi.fn();
    render(<StudentsPanel classroomId={9} selectedStudentId={null} onSelectStudent={onSelect} />);

    const mobileList = await screen.findByRole('list', { name: '學生名單（手機）' });
    await userEvent.click(within(mobileList).getByRole('button', { name: '林雨萱' }));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('one student shows the characters they misread and dashes for missing parts', async () => {
    render(<StudentsPanel classroomId={9} selectedStudentId={1} onSelectStudent={vi.fn()} />);
    // shown in the phone cards and the desktop table (CSS picks one)
    expect((await screen.findAllByText('喝采')).length).toBeGreaterThan(0);
    const row = screen.getByRole('row', { name: /甲/ });
    expect(row).toHaveTextContent('96');
    expect(row).toHaveTextContent('—');
  });

  it('opened from one assignment shows only that assignment, with a way back to it', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1, student_name: '王小明',
      rows: [
        { assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null, reading_accuracy: 96, comprehension: null, vocab: null, error_chars: [], session_id: 501 },
        { assignment_id: 11, title: '乙', due_date: null, state: 'completed', score: 70, current_step: null, reading_accuracy: 90, comprehension: null, vocab: null, error_chars: [], session_id: 502 },
      ],
    });
    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onlyAssignmentId={11} backLabel="← 回「乙」" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '← 回「乙」' })).toBeInTheDocument();
    expect(screen.queryAllByText('甲')).toHaveLength(0);
    expect(screen.getAllByText('乙').length).toBeGreaterThan(0);
  });

  it('when no part was recorded anywhere, says so instead of columns of dashes', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1, student_name: '王小明',
      rows: [{ assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: null, current_step: null, reading_accuracy: null, comprehension: null, vocab: null, error_chars: [], session_id: 503 }],
    });
    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onBack={vi.fn()} />);
    expect(await screen.findByText(/沒有記錄到朗讀、理解、生字的分項成績/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '朗讀' })).not.toBeInTheDocument();
  });

  // Issue #3682: a student stuck mid-lesson (in_progress, no part recorded
  // yet) must still be reachable from here — not just a dead-end "進行中".
  it('a student stuck in_progress with a session gets a link to their answer record', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 2, student_name: '林雨萱',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'in_progress', score: null,
        current_step: 'comprehension', reading_accuracy: null, comprehension: null, vocab: null,
        error_chars: [], session_id: 777,
      }],
    });
    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={2} onBack={vi.fn()} />);

    // rendered once in the mobile card and once in the desktop table (CSS
    // picks one, same pattern as the existing dup-text test above)
    const links = await screen.findAllByRole('link', { name: '作答紀錄' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/teacher/students/2/sessions/777/report');
    }
  });

  it('no session yet (never started) shows no answer-record link', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 2, student_name: '林雨萱',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'not_started', score: null,
        current_step: null, reading_accuracy: null, comprehension: null, vocab: null,
        error_chars: [], session_id: null,
      }],
    });
    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={2} onBack={vi.fn()} />);

    expect((await screen.findAllByText('甲')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: '作答紀錄' })).not.toBeInTheDocument();
  });
});

describe('自主練習 section (self-practice sessions)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getStudentSessions').mockResolvedValue([]);
  });

  it('shows self-practice sessions that are not linked to any assignment, and excludes the assignment-linked one', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1,
      student_name: '王小明',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null,
        reading_accuracy: 96, comprehension: null, vocab: 80, error_chars: [], session_id: 501,
      }],
    });
    vi.mocked(api.getStudentSessions).mockResolvedValue([
      { id: 501, story_title: '甲', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:10:00Z', overall_score: 80, status: 'completed' },
      { id: 900, story_title: '自己讀的課文', started_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-05T00:08:00Z', overall_score: 95, status: 'completed' },
    ]);

    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onBack={vi.fn()} />);

    expect(await screen.findByText('自主練習')).toBeInTheDocument();
    expect(screen.getAllByText('自己讀的課文').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: '查看報告' })).toHaveLength(1);
  });

  it('shows nothing when every session is already linked to an assignment', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1,
      student_name: '王小明',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null,
        reading_accuracy: 96, comprehension: null, vocab: 80, error_chars: [], session_id: 501,
      }],
    });
    vi.mocked(api.getStudentSessions).mockResolvedValue([
      { id: 501, story_title: '甲', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:10:00Z', overall_score: 80, status: 'completed' },
    ]);

    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onBack={vi.fn()} />);

    await screen.findAllByText('甲');
    expect(screen.queryByText('自主練習')).not.toBeInTheDocument();
  });

  it('does not show self-practice when opened from a single assignment (onlyAssignmentId)', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1,
      student_name: '王小明',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null,
        reading_accuracy: 96, comprehension: null, vocab: 80, error_chars: [], session_id: 501,
      }],
    });
    vi.mocked(api.getStudentSessions).mockResolvedValue([
      { id: 900, story_title: '自己讀的課文', started_at: '2026-10-05T00:00:00Z', completed_at: null, overall_score: null, status: 'in_progress' },
    ]);

    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onlyAssignmentId={10} backLabel="← 回「甲」" onBack={vi.fn()} />);

    await screen.findByRole('button', { name: '← 回「甲」' });
    expect(screen.queryByText('自主練習')).not.toBeInTheDocument();
  });

  it('shows an in-progress self-practice session without a score', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1,
      student_name: '王小明',
      rows: [],
    });
    vi.mocked(api.getStudentSessions).mockResolvedValue([
      { id: 900, story_title: '自己讀的課文', started_at: '2026-10-05T00:00:00Z', completed_at: null, overall_score: null, status: 'in_progress' },
    ]);

    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onBack={vi.fn()} />);

    expect(await screen.findByText('自主練習')).toBeInTheDocument();
    expect(screen.getAllByText('進行中').length).toBeGreaterThan(0);
  });
});
