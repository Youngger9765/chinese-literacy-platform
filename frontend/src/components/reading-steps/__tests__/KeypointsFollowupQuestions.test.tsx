import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeypointsFollowupQuestions from '../KeypointsFollowupQuestions';

describe('KeypointsFollowupQuestions (#2752 Phase 3, L0063-shape)', () => {
  it('renders each question, its options, and reveals the answer on click', () => {
    render(
      <KeypointsFollowupQuestions
        instruction="請依據第一篇文章的內容，選出正確答案"
        questions={[
          {
            answer: 'A',
            stem: '請從下列語詞中，選出用字正確的語詞。',
            options: { A: '人滿為患', B: '高棚滿座' },
            explanation: '(A)用字正確無誤',
          },
        ]}
      />,
    );
    expect(screen.getByText(/請依據第一篇文章的內容/)).toBeTruthy();
    expect(screen.getByText(/請從下列語詞中/)).toBeTruthy();
    expect(screen.getByText('A. 人滿為患')).toBeTruthy();
    expect(screen.queryByText(/答案：A/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '顯示答案' }));
    expect(screen.getByText(/答案：A/)).toBeTruthy();
    expect(screen.getByText(/用字正確無誤/)).toBeTruthy();
  });

  it('renders nothing when questions is empty', () => {
    const { container } = render(<KeypointsFollowupQuestions questions={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
