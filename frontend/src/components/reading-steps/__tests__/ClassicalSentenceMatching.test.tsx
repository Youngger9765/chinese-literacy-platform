import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Story } from '../../../types';
import ClassicalSentenceMatching from '../ClassicalSentenceMatching';

const BASE_STORY: Story = {
  id: '155', title: '不流血的戰爭', level: '文言文', content: [], thumbnail: '',
  category: 'History', filename: '', grade: '文言文',
};

describe('ClassicalSentenceMatching', () => {
  it('renders segments + reference list and reveals the matching answer on click', () => {
    const story: Story = {
      ...BASE_STORY,
      sentenceMatching: {
        reference_sentences: { '7': '我想拿下魯國和梁國，怎麼做才可以' },
        segments: [{ index: 1, classical: '吾欲下魯梁，何行而可', answer: 7 }],
      },
    };
    render(<ClassicalSentenceMatching story={story} onFinish={() => {}} />);
    expect(screen.getByText(/吾欲下魯梁/)).toBeInTheDocument();
    expect(screen.getByText(/我想拿下魯國和梁國/)).toBeInTheDocument(); // reference list always visible
    fireEvent.click(screen.getByRole('button', { name: '顯示答案' }));
    expect(screen.getByText(/對應參考句/)).toBeInTheDocument();
  });

  it('shows an honest empty state when absent', () => {
    render(<ClassicalSentenceMatching story={BASE_STORY} onFinish={() => {}} />);
    expect(screen.getByText(/本課尚無文白句子比對資料/)).toBeInTheDocument();
  });
});
