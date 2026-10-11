/**
 * Tests for issue #3406 — the "匯入均一班級學生" toggle inside the 建立班級
 * dialog must stay hidden whenever the Junyi class-import feature is
 * unavailable on the current env (JUNYI_CLASS_IMPORT_ENABLED off, list
 * endpoint 404s). Before this fix the toggle was always shown; clicking it
 * rendered JunyiClassImportSection, which silently returns null on a 404 —
 * the teacher just saw an empty panel with no explanation.
 *
 * Three states this must get right:
 * 1. Feature flag off (list endpoint 404s)  -> toggle never shown, manual
 *    mode stays the only (and default) option.
 * 2. Feature available (list endpoint succeeds) -> toggle shown.
 * 3. Manual classroom creation keeps working regardless of (1)/(2).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof classroomApi>('../../../services/classroomApi');
  return {
    ...actual,
    listMyClassrooms: vi.fn(),
    createClassroom: vi.fn(),
    listJunyiImportableClasses: vi.fn(),
    importJunyiClasses: vi.fn(),
  };
});

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'QA 老師' },
    token: 'test-token',
  }),
}));

vi.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeSchoolId: 1,
    hasMultipleSchools: false,
    teacherSchoolIds: [],
    studentSchoolIds: [],
    activeView: 'teacher',
    setActiveView: vi.fn(),
    setActiveSchoolId: vi.fn(),
    availableViews: ['teacher'],
  }),
}));

import TeacherDashboard from '../TeacherDashboard';

const JUNYI_TOGGLE_NAME = '匯入均一班級學生';

function renderDashboard() {
  const onSelectClassroom = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={['/teacher']}>
      <TeacherDashboard onSelectClassroom={onSelectClassroom} />
    </MemoryRouter>
  );
  return { onSelectClassroom, ...utils };
}

async function openCreateDialog() {
  const openButtons = await screen.findAllByRole('button', { name: '建立班級' });
  fireEvent.click(openButtons[0]);
  // The manual-create heading always renders synchronously once the dialog
  // opens, regardless of the Junyi probe's outcome.
  await screen.findByText('建立新班級');
}

describe('TeacherDashboard — Junyi import toggle visibility (issue #3406)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never shows the toggle when the feature flag is off (list endpoint 404s)', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockRejectedValue(
      new classroomApi.ClassroomApiError('Not Found', 404),
    );

    renderDashboard();
    await openCreateDialog();

    await waitFor(() => {
      expect(classroomApi.listJunyiImportableClasses).toHaveBeenCalledWith('test-token', 1);
    });

    // Hidden both before and after the probe settles to "unavailable" — the
    // initial state is `null` (unknown), which already renders as hidden,
    // so there's no show-then-hide flash on the way to "off".
    expect(screen.queryByRole('button', { name: JUNYI_TOGGLE_NAME })).not.toBeInTheDocument();
    // Manual mode remains the (only) option, fully usable.
    expect(screen.getByRole('button', { name: '手動建立' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例：五年甲班')).toBeInTheDocument();
  });

  it('shows the toggle once the probe confirms the feature is available', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({
      linked: false,
      classes: [],
    });

    renderDashboard();
    await openCreateDialog();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: JUNYI_TOGGLE_NAME })).toBeInTheDocument();
    });
  });

  it('still lets the teacher create a classroom manually when the flag is off', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockRejectedValue(
      new classroomApi.ClassroomApiError('Not Found', 404),
    );
    vi.mocked(classroomApi.createClassroom).mockResolvedValue({
      id: 42,
      name: '五年甲班',
      grade: 5,
      student_count: 0,
      school_id: 1,
      teacher_id: 1,
      is_active: true,
      created_at: '2026-10-01T00:00:00Z',
    });

    const { onSelectClassroom } = renderDashboard();
    await openCreateDialog();

    fireEvent.change(screen.getByPlaceholderText('例：五年甲班'), {
      target: { value: '五年甲班' },
    });
    fireEvent.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => {
      expect(classroomApi.createClassroom).toHaveBeenCalledWith('test-token', {
        name: '五年甲班',
        school_id: 1,
        grade: undefined,
      });
    });
    await waitFor(() => {
      expect(onSelectClassroom).toHaveBeenCalledWith(42);
    });
  });
});
