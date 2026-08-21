/**
 * PracticeStepsSummarySection.test.tsx (#2835)
 *
 * TDD-first: component must be created for these to pass.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import PracticeStepsSummarySection from '../PracticeStepsSummarySection';
import type { PracticeStepSummaryItem } from '../practiceStepsSummary';

describe('PracticeStepsSummarySection', () => {
  it('renders nothing (null) when items is empty', () => {
    const { container } = render(<PracticeStepsSummarySection items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each item label', () => {
    const items: PracticeStepSummaryItem[] = [
      { stepId: 'vocab-definition', label: '詞語理解', completed: true, scoreLabel: '答對 7/8 題' },
      { stepId: 'knowledge-station', label: '知識補給站', completed: false, scoreLabel: null },
    ];
    render(<PracticeStepsSummarySection items={items} />);
    expect(screen.getByText('詞語理解')).toBeTruthy();
    expect(screen.getByText('知識補給站')).toBeTruthy();
  });

  it('shows the score label when present', () => {
    const items: PracticeStepSummaryItem[] = [
      { stepId: 'vocab-definition', label: '詞語理解', completed: true, scoreLabel: '答對 7/8 題' },
    ];
    render(<PracticeStepsSummarySection items={items} />);
    expect(screen.getByText('答對 7/8 題')).toBeTruthy();
  });

  it('shows a completed badge when completed=true and no score', () => {
    const items: PracticeStepSummaryItem[] = [
      { stepId: 'knowledge-station', label: '知識補給站', completed: true, scoreLabel: null },
    ];
    render(<PracticeStepsSummarySection items={items} />);
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('shows a not-yet-completed indicator when completed=false', () => {
    const items: PracticeStepSummaryItem[] = [
      { stepId: 'vocab-review', label: '語詞複習', completed: false, scoreLabel: null },
    ];
    render(<PracticeStepsSummarySection items={items} />);
    expect(screen.getByText('尚未完成')).toBeTruthy();
  });

  it('renders one card per item (count matches)', () => {
    const items: PracticeStepSummaryItem[] = [
      { stepId: 'vocab-definition', label: '詞語理解', completed: true, scoreLabel: null },
      { stepId: 'vocab-application', label: '語詞應用', completed: true, scoreLabel: null },
      { stepId: 'keypoints-table', label: '文章重點表', completed: false, scoreLabel: null },
    ];
    render(<PracticeStepsSummarySection items={items} />);
    // Every label must appear exactly once
    for (const item of items) {
      expect(screen.getAllByText(item.label)).toHaveLength(1);
    }
  });
});
