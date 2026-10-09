import { describe, expect, it } from 'vitest';
import { buildAccuracyTrendPoints } from '../ClassroomAnalytics';

describe('classroom accuracy trend', () => {
  it('keeps all ten sessions started on one day in completion order', () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      started_at: '2026-09-16T08:00:00',
      completed_at: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00`,
      overall_score: 70 + index,
      status: 'completed',
      story_title: '課文',
    }));
    const points = buildAccuracyTrendPoints([{ name: '學生', sessions }]);

    expect(points).toHaveLength(10);
    expect(points.map((point) => point['學生'])).toEqual(Array.from({ length: 10 }, (_, i) => 70 + i));
  });

  it('keeps multiple sessions completed on one day and omits missing scores', () => {
    const points = buildAccuracyTrendPoints([{
      name: '學生',
      sessions: [
        { id: 1, started_at: '2026-09-16', completed_at: '2026-09-17T10:00:00', overall_score: 0, status: 'completed', story_title: '甲' },
        { id: 2, started_at: '2026-09-16', completed_at: '2026-09-17T11:00:00', overall_score: 82, status: 'completed', story_title: '乙' },
        { id: 3, started_at: '2026-09-16', completed_at: null, overall_score: null, status: 'completed', story_title: '丙' },
      ],
    }]);

    expect(points).toHaveLength(2);
    expect(points.map((point) => point['學生'])).toEqual([0, 82]);
  });
});
