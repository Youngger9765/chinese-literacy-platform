/**
 * Regression test for #2532 review (CHANGES_REQUESTED by Young).
 *
 * Scenario: 單段課 + 「再讀一次」+ 導航往返.
 * Root cause: after #2530/#2531 persist 逐段 results to DB step_data.tutor, the
 * 「再讀一次」handler must ALSO clear the DB — otherwise TutorPage restores from
 * DB.step_data.tutor (stale) on the way back and resurrects the old 成績 + all-done state.
 *
 * This test mounts a single-paragraph LiveTutor already in the completed state (via
 * initialProgress, i.e. a DB restore), clicks 「再讀一次」, and asserts onProgressChange
 * was called with an EMPTY tutor payload (line_results:[], completed_paragraphs:[]).
 *
 * RED before the fix: the old handler only did stopSession/stopTts/resetForRetry and
 * never called onProgressChange, so the DB kept the old data → resurrection.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Story } from '../../../types';
import type { TutorStepData } from '../../../types/stepProgress';
import type { DiffToken } from '../../../types';

// Context/hook stubs — same approach as src/__smoke__/render-smoke.test.tsx
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, token: 'test-token', isAuthenticated: true, isLoading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    processLinesSelective: () => null,
  }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../context/KaraokeContext', () => ({
  useKaraoke: () => ({ karaokeEnabled: false }),
  KaraokeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
}));

import LiveTutor from './LiveTutor';

// jsdom has no navigator.mediaDevices; LiveTutor pre-warms the mic on mount (rejection
// is caught internally). Stub so the mount effect doesn't throw.
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn().mockRejectedValue(new Error('no mic in test')) },
});

const SINGLE_PARA_STORY: Story = {
  id: '99',
  title: '單段測試課文',
  level: 1,
  content: ['這是唯一的一段課文。'],
  paragraphs: ['這是唯一的一段課文。'],
  thumbnail: '',
  category: 'Fable',
  filename: 'read-again-test.yml',
  grade: 4,
  charCount: 10,
  vocabulary: [],
};

const DIFF_TOKENS: DiffToken[] = [
  { char: '這', type: 'correct' },
  { char: '是', type: 'correct' },
];

// A completed single-paragraph reading as it would be restored from DB step_data.tutor.
const COMPLETED_PROGRESS: TutorStepData = {
  completed_paragraphs: [0],
  current_line_index: 0,
  paragraph_summaries: [],
  line_results: [
    { lineIndex: 0, matchRate: 0.98, cpm: 120, durationMs: 3000, transcript: '這是唯一的一段課文。', diffTokens: DIFF_TOKENS },
  ],
  paragraph_summaries_data: {
    0: { feedback: '', matchRate: 0.98, wrongCount: 0, missingCount: 0, tier: 3, geminiPending: false },
  },
};

function renderCompletedLiveTutor() {
  const onProgressChange = vi.fn();
  render(
    <LiveTutor
      story={SINGLE_PARA_STORY}
      rightPanelWidth={0}
      onPanelWidthChange={vi.fn()}
      onFinish={vi.fn()}
      onCancel={vi.fn()}
      initialProgress={COMPLETED_PROGRESS}
      onProgressChange={onProgressChange}
      dbSessionId={123}
    />,
  );
  return { onProgressChange };
}

describe('LiveTutor 「再讀一次」(#2532)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mounts a completed single-paragraph lesson showing 再讀一次', () => {
    renderCompletedLiveTutor();
    expect(screen.getByText('再讀一次')).toBeInTheDocument();
  });

  it('clicking 再讀一次 clears DB step_data.tutor (empty payload) — no resurrection on round-trip', () => {
    const { onProgressChange } = renderCompletedLiveTutor();

    fireEvent.click(screen.getByText('再讀一次'));

    // Must have written a CLEARED tutor payload to the DB so the round-trip restore
    // can't resurrect the old 成績. (RED before the fix: handler never called onProgressChange.)
    const clearingCall = onProgressChange.mock.calls.find(([data]) => {
      const d = data as TutorStepData;
      return Array.isArray(d?.line_results) && d.line_results.length === 0
        && Array.isArray(d?.completed_paragraphs) && d.completed_paragraphs.length === 0;
    });
    expect(clearingCall, 'onProgressChange 應被以清空的 tutor payload 呼叫').toBeTruthy();
    expect((clearingCall?.[0] as TutorStepData).paragraph_summaries_data).toEqual({});
  });
});
