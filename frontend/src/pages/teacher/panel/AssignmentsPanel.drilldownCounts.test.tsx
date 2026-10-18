import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import AssignmentsPanel from './AssignmentsPanel';
import * as teacherApi from '../../../services/teacherApi';
import * as assignmentApi from '../../../services/assignmentApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

vi.mock('../../../services/teacherApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/teacherApi')>()),
  getAssignmentMatrix: vi.fn(),
  getAssignmentItemStats: vi.fn(),
}));

vi.mock('../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/assignmentApi')>()),
  getClassroomAssignments: vi.fn(),
  createAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  updateAssignment: vi.fn(),
}));

vi.mock('../../../services/api', () => ({ fetchStories: vi.fn().mockResolvedValue({ stories: [], total: 0, grades: [] }) }));
vi.mock('../TextManagementTab', () => ({ default: () => <div>TextManagementTab</div> }));


// Khan Academy opens an assignment on "how many at each level"; the drilldown
// used to give one number (N / M 人已交) and a long list to scan.
describe('AssignmentsPanel — assignment detail opens on status counts', () => {
  beforeEach(() => {
    vi.mocked(teacherApi.getAssignmentItemStats).mockResolvedValue({ items: [] } as never);
    vi.mocked(teacherApi.getAssignmentMatrix).mockResolvedValue({
      students: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }, { id: 3, name: '丙' }, { id: 4, name: '丁' }],
      assignments: [{ id: 10, title: '課文', due_date: '2020-01-01T00:00:00Z' }],
      cells: [
        { student_id: 1, assignment_id: 10, state: 'completed', score: 90, current_step: null },
        { student_id: 2, assignment_id: 10, state: 'in_progress', score: null, current_step: null },
        { student_id: 3, assignment_id: 10, state: 'not_started', score: null, current_step: null },
        { student_id: 4, assignment_id: 10, state: 'not_assigned', score: null, current_step: null },
      ],
    } as never);
  });

  it('past due: 已交 1 and 逾期未交 2, the not-assigned student is not counted', async () => {
    render(<AssignmentsPanel classroomId={9} selectedAssignmentId={10} onSelectAssignment={vi.fn()} onOpenStudent={vi.fn()} />);
    const counts = await screen.findByLabelText('各狀態人數');
    await waitFor(() => expect(counts.textContent).toBe('已交1逾期未交2'));
  });
});

describe('AssignmentsPanel — download one assignment as CSV', () => {
  it('the detail has a download button that builds the CSV from the matrix', async () => {
    const created: string[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { created.push(String(b.size)); return 'blob:x'; }) as never;
    URL.revokeObjectURL = (() => {}) as never;
    vi.mocked(teacherApi.getAssignmentItemStats).mockResolvedValue({ items: [] } as never);
    vi.mocked(teacherApi.getAssignmentMatrix).mockResolvedValue({
      students: [{ id: 1, name: '甲' }],
      assignments: [{ id: 10, title: '課文', due_date: null }],
      cells: [{ student_id: 1, assignment_id: 10, state: 'completed', score: 90, current_step: null }],
    } as never);
    render(<AssignmentsPanel classroomId={9} selectedAssignmentId={10} onSelectAssignment={vi.fn()} onOpenStudent={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: /下載這份作業成績/ });
    btn.click();
    expect(created.length).toBe(1);
    URL.createObjectURL = origCreate;
  });
});
