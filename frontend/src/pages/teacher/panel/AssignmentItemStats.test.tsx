import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssignmentItemStats from './AssignmentItemStats';

const items = [
  { key: 'inferential', label: '理解-推論', completed: 17, total: 19, completion_rate: 89.5, correct_rate: 58, error_rate: 42 },
  { key: 'vocab', label: '生字', completed: 19, total: 19, completion_rate: 100, correct_rate: 79, error_rate: 21 },
  { key: 'reading', label: '朗讀', completed: 19, total: 19, completion_rate: 100, correct_rate: 84, error_rate: 16 },
];

describe('AssignmentItemStats (#3367)', () => {
  it('lists every part with completion, correct and error rate, weakest marked', () => {
    render(<AssignmentItemStats data={{ assignment_id: 1, submitted_count: 19, items }} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent?.match(/^⚠? ?(\S+?)\d/)?.[1] ?? '')).toBeTruthy();
    expect(rows[0]).toHaveAttribute('data-weakest', 'true');
    expect(rows[0]).toHaveTextContent('理解-推論');
    expect(rows[0]).toHaveTextContent('58%');
    expect(rows[0]).toHaveTextContent('42%');
    expect(rows[0]).toHaveTextContent('17/19');
    expect(rows[1]).not.toHaveAttribute('data-weakest');
  });

  it('explains the empty state instead of showing zeros', () => {
    render(<AssignmentItemStats data={{ assignment_id: 1, submitted_count: 0, items }} />);
    expect(screen.getByText(/還沒有學生交這份作業/)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
