/**
 * Unit tests for OmoHistoryList per-lesson grouping (#2089 item 1).
 *
 * The history endpoint returns a flat, newest-first list mixing every
 * lesson. The list must regroup it so each lesson's records sit under one
 * section header, in first-appearance (newest-active) order, with cards
 * still newest-first inside each group.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import OmoHistoryList from './OmoHistoryList';
import type { OmoHistoryItem } from '../../services/omoApi';

function makeItem(over: Partial<OmoHistoryItem>): OmoHistoryItem {
  return {
    upload_id: 1,
    lesson_id: 30,
    lesson_title: '都是八哥',
    grade_code: 'G7-L30',
    status: 'graded',
    overall_score: 0.8,
    answers_count: 5,
    created_at: new Date().toISOString(),
    thumbnail_url: null,
    ...over,
  };
}

describe('OmoHistoryList grouping', () => {
  it('shows the empty state when there are no items', () => {
    render(<OmoHistoryList items={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('還沒有任何批改記錄')).toBeInTheDocument();
  });

  it('groups records by lesson under one section header each', () => {
    const items: OmoHistoryItem[] = [
      makeItem({ upload_id: 1, lesson_id: 30, lesson_title: '都是八哥', grade_code: 'G7-L30' }),
      makeItem({ upload_id: 2, lesson_id: 30, lesson_title: '都是八哥', grade_code: 'G7-L30' }),
      makeItem({ upload_id: 3, lesson_id: 24, lesson_title: '碧沉西瓜', grade_code: 'G6-L24' }),
    ];
    render(<OmoHistoryList items={items} onSelect={vi.fn()} />);

    // Two section headers, one per lesson.
    const sections = screen.getAllByRole('region');
    expect(sections).toHaveLength(2);

    // The G7-L30 section header shows the lesson title + a count of 2.
    expect(screen.getByRole('heading', { name: '都是八哥' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '碧沉西瓜' })).toBeInTheDocument();

    const g730 = screen.getByRole('region', { name: '都是八哥' });
    expect(within(g730).getByText('2 筆')).toBeInTheDocument();
    // Two upload cards live under that lesson.
    expect(within(g730).getAllByRole('button')).toHaveLength(2);
  });

  it('keeps groups in first-appearance order (newest-active lesson first)', () => {
    const items: OmoHistoryItem[] = [
      makeItem({ upload_id: 1, lesson_id: 24, lesson_title: '碧沉西瓜', grade_code: 'G6-L24' }),
      makeItem({ upload_id: 2, lesson_id: 30, lesson_title: '都是八哥', grade_code: 'G7-L30' }),
    ];
    render(<OmoHistoryList items={items} onSelect={vi.fn()} />);
    const headings = screen.getAllByRole('heading');
    expect(headings.map((h) => h.textContent)).toEqual(['碧沉西瓜', '都是八哥']);
  });

  it('puts items with no lesson_id into a dedicated unidentified group', () => {
    const items: OmoHistoryItem[] = [
      makeItem({ upload_id: 1, lesson_id: null, lesson_title: null, grade_code: null, status: 'identified' }),
    ];
    render(<OmoHistoryList items={items} onSelect={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '（尚未辨識課程名稱）' })).toBeInTheDocument();
  });

  it('backfills a missing title from a later item in the same lesson group', () => {
    const items: OmoHistoryItem[] = [
      makeItem({ upload_id: 1, lesson_id: 30, lesson_title: null, grade_code: null }),
      makeItem({ upload_id: 2, lesson_id: 30, lesson_title: '都是八哥', grade_code: 'G7-L30' }),
    ];
    render(<OmoHistoryList items={items} onSelect={vi.fn()} />);
    // Only one group, titled from the item that had the name.
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '都是八哥' })).toBeInTheDocument();
  });

  it('invokes onSelect with the upload id when a card is clicked', () => {
    const onSelect = vi.fn();
    render(
      <OmoHistoryList items={[makeItem({ upload_id: 42 })]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(42);
  });
});
