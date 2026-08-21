import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Story } from '../../../types';
import ClassicalSelfChallenge from '../ClassicalSelfChallenge';

const BASE_STORY: Story = {
  id: '155', title: '不流血的戰爭', level: '文言文', content: [], thumbnail: '',
  category: 'History', filename: '', grade: '文言文',
};

describe('ClassicalSelfChallenge', () => {
  it('renders the passage, part_one and part_two, revealing answers on click', () => {
    const story: Story = {
      ...BASE_STORY,
      selfChallenge: {
        passage: '弈秋，通國之善弈者也。',
        part_one: { label: '（一）', items: [{ index: 1, stem: '主語是誰？', answer: '弈秋' }] },
        part_two: {
          label: '（二）',
          items: [{ index: 1, stem: '主旨為何？', options: { A: '甲', C: '丙' }, answer: 'C' }],
        },
      },
    };
    render(<ClassicalSelfChallenge story={story} onFinish={() => {}} />);
    expect(screen.getByText(/弈秋，通國之善弈者也/)).toBeInTheDocument();
    expect(screen.getByText(/主語是誰/)).toBeInTheDocument();
    expect(screen.getByText(/主旨為何/)).toBeInTheDocument();
    const revealButtons = screen.getAllByRole('button', { name: '顯示答案' });
    expect(revealButtons).toHaveLength(2);
    fireEvent.click(revealButtons[0]);
    expect(screen.getByText(/答案：弈秋/)).toBeInTheDocument();
  });

  it('shows an honest empty state when absent', () => {
    render(<ClassicalSelfChallenge story={BASE_STORY} onFinish={() => {}} />);
    expect(screen.getByText(/本課尚無自我挑戰資料/)).toBeInTheDocument();
  });
});
