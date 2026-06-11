/**
 * Characterization tests for FullReading UI sub-panels (Issue #1960).
 *
 * TDD-first: written BEFORE the components exist so they fail (RED),
 * then pass once the components are extracted (GREEN).
 *
 * Panels under test:
 *   - FullReadingControls  — play/record/restart buttons
 *   - FullReadingScoreCard — star encouragement + transcript + diff
 *   - FullReadingFeedbackPanel — per-paragraph feedback display
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── 1. FullReadingControls ────────────────────────────────────────────────────
import FullReadingControls from '../FullReadingControls';

describe('FullReadingControls', () => {
  const noop = () => {};

  it('renders AI朗讀 and 開始朗讀 buttons in idle state', () => {
    render(
      <FullReadingControls
        state="idle"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    expect(screen.getByText('AI 朗讀')).toBeInTheDocument();
    expect(screen.getByText('開始朗讀')).toBeInTheDocument();
  });

  it('calls onStartSession when 開始朗讀 is clicked', () => {
    const onStartSession = vi.fn();
    render(
      <FullReadingControls
        state="idle"
        onSpeak={noop}
        onStartSession={onStartSession}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    fireEvent.click(screen.getByText('開始朗讀'));
    expect(onStartSession).toHaveBeenCalledTimes(1);
  });

  it('renders 完成 and 取消 buttons when recording is active', () => {
    render(
      <FullReadingControls
        state="recording"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onCancel={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={true}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('renders 準備中... button when preparing', () => {
    render(
      <FullReadingControls
        state="preparing"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    expect(screen.getByText('準備中...')).toBeInTheDocument();
  });

  it('renders TTS controls when playing', () => {
    render(
      <FullReadingControls
        state="ttsPlaying"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    expect(screen.getByText('暫停')).toBeInTheDocument();
    expect(screen.getByText('停止')).toBeInTheDocument();
  });

  it('shows 繼續 when TTS is paused', () => {
    render(
      <FullReadingControls
        state="ttsPlaying"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={true}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    expect(screen.getByText('繼續')).toBeInTheDocument();
  });

  it('renders 再讀一次 and 下一關 when result is available', () => {
    render(
      <FullReadingControls
        state="result"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    expect(screen.getByText('再讀一次')).toBeInTheDocument();
    expect(screen.getByText('下一關')).toBeInTheDocument();
  });

  it('calls onRetry when 再讀一次 is clicked', () => {
    const onRetry = vi.fn();
    render(
      <FullReadingControls
        state="result"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={onRetry}
        onFinish={noop}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    fireEvent.click(screen.getByText('再讀一次'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onFinish when 下一關 is clicked', () => {
    const onFinish = vi.fn();
    render(
      <FullReadingControls
        state="result"
        onSpeak={noop}
        onStartSession={noop}
        onSubmit={noop}
        onStopTts={noop}
        onPauseTts={noop}
        onResumeTts={noop}
        onRetry={noop}
        onFinish={onFinish}
        isTtsPaused={false}
        sessionTranscriptReady={false}
        inToolbox={false}
        recordingSecs={0}
      />
    );
    fireEvent.click(screen.getByText('下一關'));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

// ── 2. FullReadingScoreCard ───────────────────────────────────────────────────
import FullReadingScoreCard from '../FullReadingScoreCard';

describe('FullReadingScoreCard', () => {
  const baseResult = {
    matchRate: 0.92,
    feedback: '很好',
    diffTokens: [{ type: 'correct', text: '你好' }],
    cpm: 120,
    durationMs: 5000,
    errorBreakdown: { correct: 10, wrong: 0, missing: 0, extra: 0 },
  };

  it('renders 5 stars and encouragement text for high match rate', () => {
    render(
      <FullReadingScoreCard
        result={baseResult}
        streamingTranscript="你好世界"
        audioUrl={null}
      />
    );
    // 5 stars rendered (material-symbols star icons)
    const stars = document.querySelectorAll('.material-symbols-outlined');
    expect(stars.length).toBeGreaterThanOrEqual(5);
    // Encouragement text for 0.92 → 5 stars
    expect(screen.getByText('太厲害了！')).toBeInTheDocument();
  });

  it('shows 你說的 transcript section when transcript is provided', () => {
    render(
      <FullReadingScoreCard
        result={baseResult}
        streamingTranscript="你好世界"
        audioUrl={null}
      />
    );
    expect(screen.getByText('你說的')).toBeInTheDocument();
    expect(screen.getByText('你好世界')).toBeInTheDocument();
  });

  it('does not render transcript section when transcript is empty', () => {
    render(
      <FullReadingScoreCard
        result={baseResult}
        streamingTranscript=""
        audioUrl={null}
      />
    );
    expect(screen.queryByText('你說的')).not.toBeInTheDocument();
  });

  it('renders audio element when audioUrl is provided', () => {
    const { container } = render(
      <FullReadingScoreCard
        result={baseResult}
        streamingTranscript=""
        audioUrl="blob:test-url"
      />
    );
    const audio = container.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio?.src).toContain('test-url');
  });

  it('does not render audio element when audioUrl is null', () => {
    const { container } = render(
      <FullReadingScoreCard
        result={baseResult}
        streamingTranscript=""
        audioUrl={null}
      />
    );
    expect(container.querySelector('audio')).not.toBeInTheDocument();
  });

  it('renders correct encouragement for mid match rate (0.78 → 4 stars)', () => {
    render(
      <FullReadingScoreCard
        result={{ ...baseResult, matchRate: 0.78 }}
        streamingTranscript=""
        audioUrl={null}
      />
    );
    expect(screen.getByText('唸得很流暢！')).toBeInTheDocument();
  });

  it('renders correct encouragement for low match rate (0.3 → 2 stars)', () => {
    render(
      <FullReadingScoreCard
        result={{ ...baseResult, matchRate: 0.3 }}
        streamingTranscript=""
        audioUrl={null}
      />
    );
    expect(screen.getByText('再多練幾次就會更熟～')).toBeInTheDocument();
  });
});

// ── 3. FullReadingFeedbackPanel ───────────────────────────────────────────────
import FullReadingFeedbackPanel from '../FullReadingFeedbackPanel';

describe('FullReadingFeedbackPanel', () => {
  it('renders diff section when diffTokens are present', () => {
    const diffTokens = [
      { type: 'correct', text: '你好' },
      { type: 'wrong', text: '世界' },
    ];
    render(
      <FullReadingFeedbackPanel diffTokens={diffTokens} />
    );
    expect(screen.getByText('逐字比對')).toBeInTheDocument();
  });

  it('does not render diff section when diffTokens is empty', () => {
    render(
      <FullReadingFeedbackPanel diffTokens={[]} />
    );
    expect(screen.queryByText('逐字比對')).not.toBeInTheDocument();
  });

  it('does not render diff section when diffTokens is undefined', () => {
    render(
      <FullReadingFeedbackPanel diffTokens={undefined} />
    );
    expect(screen.queryByText('逐字比對')).not.toBeInTheDocument();
  });
});
