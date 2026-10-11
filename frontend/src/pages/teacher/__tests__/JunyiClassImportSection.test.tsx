/**
 * Tests for JunyiClassImportSection — issue #3380.
 *
 * This section lives inside the teacher's "建立班級" dialog, next to the
 * existing (manual) way of creating a classroom. It lets a teacher import
 * their Junyi classes + students on demand (no nightly sync, no new DB
 * table — see issue #3380 for the full architecture).
 *
 * Three states this component must render correctly:
 * 1. Feature flag off (API 404)        -> renders nothing at all.
 * 2. Teacher not linked to Junyi SSO   -> explanatory text, no checkboxes.
 * 3. Teacher linked, classes returned  -> checkboxes; already-imported ones
 *    are disabled and labelled "已匯入"; selecting + importing shows
 *    "新增 N 位、已存在略過 M 位"; a T+1 freshness note is always shown.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JunyiClassImportSection from '../JunyiClassImportSection';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof classroomApi>('../../../services/classroomApi');
  return {
    ...actual,
    listJunyiImportableClasses: vi.fn(),
    importJunyiClasses: vi.fn(),
  };
});

const DEFAULT_PROPS = {
  token: 'test-token',
  schoolId: 1,
  onImported: vi.fn(),
};

describe('JunyiClassImportSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when the feature flag is off (API 404)', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockRejectedValue(
      new classroomApi.ClassroomApiError('Not Found', 404),
    );

    const { container } = render(<JunyiClassImportSection {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(classroomApi.listJunyiImportableClasses).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows explanatory text (no checkboxes) when the teacher is not linked to Junyi', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({
      linked: false,
      classes: [],
    });

    render(<JunyiClassImportSection {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText(/均一/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('lists classes as checkboxes, disables already-imported ones, and shows the T+1 note', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({
      linked: true,
      classes: [
        { junyi_class_id: 'c1', class_name: '均一一班', class_code: 'AAAAA', student_count: 20, already_imported: false },
        { junyi_class_id: 'c2', class_name: '均一二班', class_code: 'BBBBB', student_count: 15, already_imported: true },
      ],
    });

    render(<JunyiClassImportSection {...DEFAULT_PROPS} />);

    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);

    // c1: selectable
    expect(checkboxes[0]).not.toBeDisabled();
    // c2: already imported -> disabled + labelled
    expect(checkboxes[1]).toBeDisabled();
    expect(screen.getByText('已匯入')).toBeInTheDocument();

    // T+1 freshness note always shown
    expect(screen.getByText(/今天新建的班.*明天才查得到|明天.*查得到/)).toBeInTheDocument();
  });

  it('imports selected classes and shows "新增 N 位、已存在略過 M 位"', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({
      linked: true,
      classes: [
        { junyi_class_id: 'c1', class_name: '均一一班', class_code: 'AAAAA', student_count: 20, already_imported: false },
      ],
    });
    vi.mocked(classroomApi.importJunyiClasses).mockResolvedValue({
      added_students: 18,
      skipped_existing_students: 2,
      classes_created: 1,
      classes_reused: 0,
    });

    const user = userEvent.setup();
    render(<JunyiClassImportSection {...DEFAULT_PROPS} />);

    const checkbox = await screen.findByRole('checkbox', { name: /均一一班/ });
    await user.click(checkbox);

    const importButton = screen.getByRole('button', { name: /匯入/ });
    await user.click(importButton);

    await waitFor(() => {
      expect(classroomApi.importJunyiClasses).toHaveBeenCalledWith(
        DEFAULT_PROPS.token,
        DEFAULT_PROPS.schoolId,
        ['c1'],
      );
    });

    expect(await screen.findByText(/新增\s*18\s*位、已存在略過\s*2\s*位/)).toBeInTheDocument();
    expect(DEFAULT_PROPS.onImported).toHaveBeenCalled();
  });

  it('does not allow submitting import with zero classes selected', async () => {
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({
      linked: true,
      classes: [
        { junyi_class_id: 'c1', class_name: '均一一班', class_code: 'AAAAA', student_count: 20, already_imported: false },
      ],
    });

    render(<JunyiClassImportSection {...DEFAULT_PROPS} />);
    await screen.findByRole('checkbox', { name: /均一一班/ });

    const importButton = screen.getByRole('button', { name: /匯入/ });
    expect(importButton).toBeDisabled();
    expect(classroomApi.importJunyiClasses).not.toHaveBeenCalled();
  });
});
