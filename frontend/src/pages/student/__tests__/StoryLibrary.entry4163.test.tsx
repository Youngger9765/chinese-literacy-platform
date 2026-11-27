/**
 * #4163 學習入口：課文庫頂端的「讓 AI 派一課／自己挑課」只給學生看，
 * 有未完成老師作業時顯示提醒列；老師或沒角色的帳號不出現。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

let authUser: { id: number; role?: string } = { id: 1, role: 'student' };
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 't', user: authUser }),
}));
const stories = [
  { id: '20011', title: '十秒的背後', grade: '4', genre: '說明文', level: '4', content: [], thumbnail: '', category: 'Daily', filename: '', charCount: 100 },
];
vi.mock('../../../services/api', () => ({
  fetchStories: vi.fn(async () => ({ stories, grades: ['4'] })),
  fetchStory: vi.fn(),
}));
vi.mock('../../../services/teacherApi', () => ({ getClassroomTexts: vi.fn() }));
vi.mock('../../../services/gamificationApi', () => ({
  getGamificationPoints: vi.fn(async () => ({ level_info: { xp_to_next: 100 } })),
}));
vi.mock('../../../services/progressApi', () => ({
  getLibraryStatus: vi.fn(async () => ({})),
  getStoryRecommendations: vi.fn(async () => []),
}));
vi.mock('../../../services/assignmentApi', () => ({
  getMyAssignments: vi.fn(async () => [
    { assignment_id: 1, status: 'pending' },
    { assignment_id: 2, status: 'in_progress' },
    { assignment_id: 3, status: 'completed' },
  ]),
}));

import StoryLibrary from '../StoryLibrary';

const renderLib = async () => {
  render(<MemoryRouter><StoryLibrary onStartReading={vi.fn()} /></MemoryRouter>);
  await screen.findByText('十秒的背後');
};

describe('#4163 課文庫頂端入口', () => {
  beforeEach(() => { sessionStorage.clear(); authUser = { id: 1, role: 'student' }; });

  it('學生：看到兩張入口卡，並提醒 2 份未完成作業（已完成的不算）', async () => {
    await renderLib();
    expect(screen.getByTestId('learning-entry')).toBeTruthy();
    expect(screen.getByTestId('entry-ai')).toBeTruthy();
    expect(screen.getByTestId('entry-self')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('assignment-reminder').textContent).toContain('2'));
  });

  it('老師：不出現入口卡', async () => {
    authUser = { id: 2, role: 'teacher' };
    await renderLib();
    expect(screen.queryByTestId('learning-entry')).toBeNull();
  });

  it('沒有角色資料：不出現入口卡（對照：預設不顯示）', async () => {
    authUser = { id: 3 };
    await renderLib();
    expect(screen.queryByTestId('learning-entry')).toBeNull();
  });
});
