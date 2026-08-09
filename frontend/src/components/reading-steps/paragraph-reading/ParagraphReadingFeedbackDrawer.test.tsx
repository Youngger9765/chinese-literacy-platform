import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ParagraphReadingFeedbackDrawer from './ParagraphReadingFeedbackDrawer';

const baseProps = {
  show: false,
  onClose: () => {},
  scrollRef: { current: null },
  isSessionActive: false,
  isPreparing: false,
  streamingUserInput: '',
  rightPanelDiffTokens: null,
  targetText: '你好',
  paragraphSummary: null,
  currentLineIndex: 0,
  totalLines: 1,
  completedCount: 0,
  retryCount: 0,
  micError: '',
};

describe('ParagraphReadingFeedbackDrawer — hidden in Live Tutor layout (#8bff6795)', () => {
  it('renders nothing when show=false', () => {
    const { container } = render(<ParagraphReadingFeedbackDrawer {...baseProps} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('朗讀回饋')).not.toBeInTheDocument();
  });

  it('renders drawer chrome when show=true', () => {
    const { container } = render(<ParagraphReadingFeedbackDrawer {...baseProps} show />);
    expect(screen.getAllByText('朗讀回饋').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('button')).toBeTruthy();
  });
});
