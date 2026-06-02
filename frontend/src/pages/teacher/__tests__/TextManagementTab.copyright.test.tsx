/**
 * TDD tests for issue #1983:
 * Platform YAML texts (all stories in fetchStories) should NOT require
 * copyright checkbox — the assign button must be enabled immediately.
 *
 * All stories returned by fetchStories are internal platform content.
 * The copyright checkbox should be removed from the TextManagementTab flow.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import TextManagementTab from '../TextManagementTab';

// Mock auth context
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

// Mock teacher API
vi.mock('../../../services/teacherApi', () => ({
  getClassroomTexts: vi.fn().mockResolvedValue([]),
  assignText: vi.fn().mockResolvedValue({
    id: 1,
    text_id: 'story-1',
    title: '贏得喝采的輸家',
    assigned_at: '2026-05-26T00:00:00Z',
  }),
  unassignText: vi.fn().mockResolvedValue(undefined),
  listStoryTags: vi.fn().mockResolvedValue([]),
  TeacherApiError: class TeacherApiError extends Error {},
}));

// Mock fetchStories — returns platform YAML stories (all internal content)
vi.mock('../../../services/api', () => ({
  fetchStories: vi.fn().mockResolvedValue({
    stories: [
      {
        id: 'story-1',
        title: '贏得喝采的輸家',
        grade: 5,
        genre: '記敘文',
        charCount: 800,
        filename: 'story-1.yaml',
      },
      {
        id: 'story-2',
        title: '孔子與學問',
        grade: 6,
        genre: '議論文',
        charCount: 600,
        filename: 'story-2.yaml',
      },
    ],
    total: 2,
    grades: [5, 6],
  }),
}));

describe('TextManagementTab — copyright checkbox behavior for platform texts (#1983)', () => {
  const renderTab = () => render(<TextManagementTab classroomId={1} />);

  it('should NOT show copyright checkbox when assign selector is open', async () => {
    renderTab();

    // Wait for initial load to finish
    await waitFor(() => expect(screen.queryByText('載入課文列表...')).not.toBeInTheDocument());

    // Open the assign selector
    const assignBtn = screen.getByRole('button', { name: /指派課文/ });
    fireEvent.click(assignBtn);

    // Wait for stories to load
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeInTheDocument());

    // Copyright checkbox should NOT be present for platform texts
    expect(screen.queryByText('我確認本教材的使用符合著作權規範')).not.toBeInTheDocument();
  });

  it('assign button for platform story should be enabled without any checkbox interaction', async () => {
    renderTab();

    await waitFor(() => expect(screen.queryByText('載入課文列表...')).not.toBeInTheDocument());

    // Open assign selector
    fireEvent.click(screen.getByRole('button', { name: /指派課文/ }));

    // Wait for stories
    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeInTheDocument());

    // All assign buttons should be enabled immediately (no checkbox gating)
    const allAssignBtns = screen.getAllByRole('button', { name: /^指派$/ });
    expect(allAssignBtns.length).toBeGreaterThan(0);
    allAssignBtns.forEach((btn) => {
      expect(btn).not.toBeDisabled();
    });
  });

  it('clicking assign on a platform story should call assignText with copyright_confirmed=true', async () => {
    const { assignText } = await import('../../../services/teacherApi');
    (assignText as ReturnType<typeof vi.fn>).mockClear();
    renderTab();

    await waitFor(() => expect(screen.queryByText('載入課文列表...')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /指派課文/ }));

    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeInTheDocument());

    const assignBtns = screen.getAllByRole('button', { name: /^指派$/ });
    fireEvent.click(assignBtns[0]);

    await waitFor(() => expect(assignText).toHaveBeenCalledWith(
      'test-token',
      1,
      'story-1',
      true, // copyright_confirmed always true for platform texts — no user confirmation needed
    ));
  });

  it('should show 平台教材 badge on platform story rows', async () => {
    renderTab();

    await waitFor(() => expect(screen.queryByText('載入課文列表...')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /指派課文/ }));

    await waitFor(() => expect(screen.getByText('贏得喝采的輸家')).toBeInTheDocument());

    // Each platform row should have the platform badge
    const badges = screen.getAllByText('平台教材');
    expect(badges.length).toBeGreaterThan(0);
  });
});
