import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Story } from '../../../types';
import ClassicalWordMatching from '../ClassicalWordMatching';

const BASE_STORY: Story = {
  id: '155', title: '不流血的戰爭', level: '文言文', content: [], thumbnail: '',
  category: 'History', filename: '', grade: '文言文',
};

describe('ClassicalWordMatching', () => {
  it('renders each item and reveals its answer on click', () => {
    const story: Story = {
      ...BASE_STORY,
      wordMatching: {
        items: [{
          index: 1,
          classical: '桓公曰：「吾欲下魯梁，何行而可？」',
          vernacular: '齊桓公說：「我想（　）魯國和梁國，怎麼（　）才可以？」',
          blanks: [{ answer: '拿下' }, { answer: '做' }],
        }],
      },
    };
    render(<ClassicalWordMatching story={story} onFinish={() => {}} />);
    expect(screen.getByText(/吾欲下魯梁/)).toBeInTheDocument();
    expect(screen.queryByText(/拿下、做/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '顯示答案' }));
    expect(screen.getByText(/拿下、做/)).toBeInTheDocument();
  });

  it('shows an honest empty state when absent', () => {
    render(<ClassicalWordMatching story={BASE_STORY} onFinish={() => {}} />);
    expect(screen.getByText(/本課尚無文白詞語比對資料/)).toBeInTheDocument();
  });
});
