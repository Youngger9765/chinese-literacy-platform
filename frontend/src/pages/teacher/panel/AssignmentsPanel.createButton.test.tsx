import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const emptyMatrix = { assignments: [], students: [], cells: [] };

describe('AssignmentsPanel — 建立任務 button at the top (#3401)', () => {
  beforeEach(() => {
    vi.mocked(teacherApi.getAssignmentMatrix).mockResolvedValue(emptyMatrix as never);
    vi.mocked(assignmentApi.getClassroomAssignments).mockResolvedValue({ items: [] } as never);
  });

  it('shows a prominent 建立任務 button at the top, above the matrix', async () => {
    render(
      <AssignmentsPanel
        classroomId={9}
        selectedAssignmentId={null}
        onSelectAssignment={vi.fn()}
        onOpenStudent={vi.fn()}
      />,
    );
    await waitFor(() => expect(teacherApi.getAssignmentMatrix).toHaveBeenCalled());

    const topButton = await screen.findByRole('button', { name: '建立作業' });
    expect(topButton).toBeInTheDocument();

    // It must appear before the "建立與管理作業" collapsible section in the DOM
    // (i.e. above the matrix / manage section, reference-UI).
    const manageHeading = screen.getByRole('button', { name: /建立與管理作業/ });
    expect(
      topButton.compareDocumentPosition(manageHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('clicking it expands 建立與管理作業 and opens the create-assignment form directly', async () => {
    render(
      <AssignmentsPanel
        classroomId={9}
        selectedAssignmentId={null}
        onSelectAssignment={vi.fn()}
        onOpenStudent={vi.fn()}
      />,
    );
    await waitFor(() => expect(teacherApi.getAssignmentMatrix).toHaveBeenCalled());

    // The manage section starts collapsed, so the create form is not visible yet.
    expect(screen.queryByText('選擇課文')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '建立作業' }));

    // Expands the collapsible section...
    expect(screen.getByRole('button', { name: /建立與管理作業/ })).toHaveAttribute('aria-expanded', 'true');
    // ...and opens the existing create-assignment form (AssignmentCreateForm renders a
    // "選擇課文" field) without the user having to click "建立作業" a second time.
    await waitFor(() => expect(screen.getByText('選擇課文')).toBeInTheDocument());
  });

  it('clicking it again after it is already open does not throw or reset the open form', async () => {
    render(
      <AssignmentsPanel
        classroomId={9}
        selectedAssignmentId={null}
        onSelectAssignment={vi.fn()}
        onOpenStudent={vi.fn()}
      />,
    );
    await waitFor(() => expect(teacherApi.getAssignmentMatrix).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: '建立作業' }));
    await waitFor(() => expect(screen.getByText('選擇課文')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '建立作業' }));
    expect(screen.getByText('選擇課文')).toBeInTheDocument();
  });
});
