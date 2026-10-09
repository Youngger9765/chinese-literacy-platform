import React from 'react';
import { it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import HeatmapChart from './HeatmapChart';
import { ClassroomHeatmap } from '../../services/teacherApi';

const data: ClassroomHeatmap = {
  students: [{ id: 1, name: '小明' }],
  stories: [
    { id: '1', title: '課文一' },
    { id: '2', title: '課文二' },
    { id: '3', title: '課文三' },
    { id: '4', title: '課文四' },
  ],
  scores: [
    { student_id: 1, story_id: '1', score: null, status: 'completed' },
    { student_id: 1, story_id: '2', score: null, status: 'in_progress' },
    { student_id: 1, story_id: '3', score: null, status: 'abandoned' },
    { student_id: 1, story_id: '4', score: 0, status: 'completed' },
  ],
};

it('shows unscored statuses without a red zero and keeps a real zero', () => {
  render(<HeatmapChart data={data} />);
  const cells = within(screen.getByRole('table')).getAllByRole('cell');
  expect(cells[1]).toHaveTextContent('未完成');
  expect(cells[2]).toHaveTextContent('進行中');
  expect(cells[2].querySelector('span')).toHaveClass('border-dashed');
  expect(cells[3]).toHaveTextContent('未完成');
  expect(cells[4]).toHaveTextContent('0');
  expect(cells[4].querySelector('span')).toHaveClass('bg-red-400');
  for (const cell of cells.slice(1, 4)) {
    expect(cell).not.toHaveTextContent('0');
    expect(cell.querySelector('span')).not.toHaveClass('bg-red-400');
  }
});
