/**
 * WrongAnswerReviewList.test.tsx — TDD lock for the shared 錯題解析 card list
 * (issue #2773). Answer text values below come from the real story 20011
 * payload (`curl .../api/stories/20011`), not invented: multiple_choice[0]
 * options include 「不分上下」(the correct pick) and vocab_bank 'I' is
 * 「摸不著頭緒」.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WrongAnswerReviewList, type WrongAnswerReviewItem } from '../WrongAnswerReviewList';

const ITEMS: WrongAnswerReviewItem[] = [
  {
    id: 0,
    promptText: '請問「勢均力敵」，可以用哪個詞語替換？',
    correct: true,
    correctAnswerText: '不分上下',
    studentAnswerText: null,
  },
  {
    id: 1,
    promptText: '這個問題很複雜，一時之間讓人（　），無法解決。',
    correct: false,
    correctAnswerText: '摸不著頭緒',
    studentAnswerText: '疑難雜症',
  },
];

describe('WrongAnswerReviewList', () => {
  it('🔴 fail-closed: revealed=false renders nothing, even though correct answers are in props', () => {
    render(<WrongAnswerReviewList items={ITEMS} revealed={false} />);
    expect(screen.queryByTestId('wrong-answer-review-list')).toBeNull();
    // The literal answer text must not reach the DOM pre-submission — this is
    // the actual assertion the 🔴 red line in #2773 cares about, not just the
    // container being absent.
    expect(screen.queryByText('摸不著頭緒')).toBeNull();
    expect(screen.queryByText('疑難雜症')).toBeNull();
  });

  it('renders one card per item once revealed', () => {
    render(<WrongAnswerReviewList items={ITEMS} revealed />);
    expect(screen.getByText('請問「勢均力敵」，可以用哪個詞語替換？')).toBeInTheDocument();
    expect(screen.getByText(/這個問題很複雜/)).toBeInTheDocument();
  });

  it('shows "你選了 X → 正確：Y" only for wrong items', () => {
    render(<WrongAnswerReviewList items={ITEMS} revealed />);
    expect(screen.getByText('疑難雜症')).toBeInTheDocument();
    expect(screen.getByText('摸不著頭緒')).toBeInTheDocument();
    expect(screen.getByText(/你選了/)).toBeInTheDocument();
  });

  it('does NOT render "你選了" for a correct item, but still shows the correct answer', () => {
    render(
      <WrongAnswerReviewList
        items={[{ id: 0, promptText: 'q', correct: true, correctAnswerText: 'ans', studentAnswerText: null }]}
        revealed
      />,
    );
    expect(screen.queryByText(/你選了/)).toBeNull();
    expect(screen.getByText('ans')).toBeInTheDocument();
  });

  it('ignores studentAnswerText for a correct item even if the caller mistakenly sets it', () => {
    render(
      <WrongAnswerReviewList
        items={[{ id: 0, promptText: 'q', correct: true, correctAnswerText: 'ans', studentAnswerText: 'should-not-show' }]}
        revealed
      />,
    );
    expect(screen.queryByText(/你選了/)).toBeNull();
    expect(screen.queryByText('should-not-show')).toBeNull();
  });

  it('renders nothing for an empty item list (still gated correctly, no crash)', () => {
    render(<WrongAnswerReviewList items={[]} revealed />);
    expect(screen.getByTestId('wrong-answer-review-list')).toBeEmptyDOMElement();
  });
});
