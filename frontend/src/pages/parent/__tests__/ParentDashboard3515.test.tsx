/**
 * #3515 — what a parent sees for a linked child (staging QA 2026-10-14):
 * the finished lesson read 「20011」, there was no assignment list at all,
 * and the activity chart only drew scores so unscored work left it empty.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 1, name: '家長', roles: [] } }) }));
const api = vi.hoisted(() => ({
  listLinkedChildren: vi.fn(),
  fetchChildDashboard: vi.fn(),
  fetchChildAssignments: vi.fn(),
  redeemParentInviteCode: vi.fn(),
}));
vi.mock('../../../services/parentApi', () => api);

import ParentDashboard, { latestPerAssignment } from '../ParentDashboard';

const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(15 + (i % 15)).padStart(2, '0')}`, sessions_completed: i === 29 ? 1 : 0, avg_score: null }));
const row = (o: Record<string, unknown>) => ({ assignment_id: 1, title: null, story_title: '贏得喝采的輸家', due_date: null, status: 'pending', score: null, attempt_number: 1, ...o });

describe('#3515 parent view of a child', () => {
  it('shows lesson titles, the assignment list with status, and collapses retries', async () => {
    api.listLinkedChildren.mockResolvedValue([{ student_id: 7, student_name: '小孩甲', linked_at: '2026-10-14' }]);
    api.fetchChildDashboard.mockResolvedValue({
      total_sessions: 1, completed_sessions: 1, avg_score: null, today_sessions: 1, week_sessions: 1,
      streak_days: 0, longest_streak: 0, daily_activity: days,
      completed_story_slugs: ['20011'], completed_stories: [{ slug: '20011', title: '贏得喝采的輸家' }],
    });
    api.fetchChildAssignments.mockResolvedValue([
      row({ assignment_id: 1, title: '第一課作業', status: 'in_progress', attempt_number: 1 }),
      row({ assignment_id: 1, title: '第一課作業', status: 'submitted', attempt_number: 2, score: 88 }),
      row({ assignment_id: 2, title: '第二課作業', due_date: '2020-01-01T00:00:00Z', status: 'pending' }),
    ]);
    render(<ParentDashboard />);
    const list = await screen.findByRole('list', { name: '老師派的作業' });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('第一課作業');
    expect(items[0]).toContain('已交');
    expect(items[0]).toContain('88 分');
    expect(items[1]).toContain('逾期未交');
    // finished lesson shows its title, never the raw number
    expect(screen.getAllByText('贏得喝采的輸家').length).toBeGreaterThan(0);
    expect(screen.queryByText('20011')).toBeNull();
    expect(screen.getByText('近 30 天每天完成篇數')).toBeTruthy();
  });

  it('latestPerAssignment keeps the highest attempt', () => {
    const out = latestPerAssignment([
      row({ status: 'submitted', attempt_number: 2 }), row({ status: 'in_progress', attempt_number: 1 }),
    ] as never);
    expect(out.map((r) => r.status)).toEqual(['submitted']);
  });
});
