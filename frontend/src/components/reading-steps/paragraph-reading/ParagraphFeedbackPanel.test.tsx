import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ParagraphFeedbackPanel from './ParagraphFeedbackPanel';
import type { DiffToken } from '../../../types';

const tokensWithZhuyin: DiffToken[] = [
  { char: '你', type: 'correct', zhuyin: 'ㄋㄧˇ' },
  { char: '好', type: 'correct', zhuyin: 'ㄏㄠˇ' },
];

describe('ParagraphFeedbackPanel — bopomofo ruby via DiffDisplay (#2226)', () => {
  it('renders ruby annotations when diff tokens carry zhuyin', () => {
    const { container } = render(
      <ParagraphFeedbackPanel
        width={400}
        isMobile={false}
        scrollRef={{ current: null }}
        isSessionActive={false}
        isPreparing={false}
        streamingUserInput=""
        rightPanelDiffTokens={tokensWithZhuyin}
        targetText="你好"
        paragraphSummary={{
          feedback: '',
          matchRate: 1,
          wrongCount: 0,
          missingCount: 0,
          tier: 1,
          geminiPending: false,
        }}
        currentLineIndex={0}
        totalLines={1}
        completedCount={1}
        retryCount={0}
        micError=""
      />,
    );
    expect(container.querySelectorAll('ruby').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('ㄋㄧˇ');
  });
});
