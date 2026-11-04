/**
 * Tests for McqRescueDialog's AI kill switch behavior (Issue #3838).
 *
 * The whole dialog is an AI feature (an AI tutor rescuing a student who got
 * an MCQ wrong), so when disabled it must show a clear notice and never
 * call mcqRescueStart — not a generic "connection failed" message that
 * looks like a transient error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import McqRescueDialog, { McqRescueContext } from './McqRescueDialog';
import * as learningApi from '../../services/learningApi';
import { _resetAiFeaturesCacheForTests } from '../../hooks/useAiFeaturesEnabled';

vi.mock('../../contexts/AuthContext', async () => {
  const fake = { token: 'test-token', user: { id: 1, name: '小明', role: 'student' } };
  return { useAuth: () => fake };
});

function stubFeaturesFetch(aiFeaturesEnabled: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/api/features')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: aiFeaturesEnabled }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  );
}

const CONTEXT: McqRescueContext = {
  questionId: 'q1',
  lessonId: 'L06',
  wrongChoice: 'A',
  wrongChoiceText: '自然環境',
  questionText: '這篇課文主要在說什麼？',
  correctAnswer: 'B',
  correctAnswerText: '科技發展',
  options: ['自然環境', '科技發展'],
  optionLabels: ['A', 'B'],
  strategyType: null,
};

describe('McqRescueDialog — AI kill switch (#3838)', () => {
  beforeEach(() => {
    _resetAiFeaturesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAiFeaturesCacheForTests();
  });

  it('does not call mcqRescueStart and shows the disabled notice when AI is off', async () => {
    stubFeaturesFetch(false);
    const startSpy = vi.spyOn(learningApi, 'mcqRescueStart');

    render(
      <McqRescueDialog isOpen={true} context={CONTEXT} onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText('AI 功能暫時關閉')).toBeInTheDocument());
    expect(startSpy).not.toHaveBeenCalled();
    // The send button stays disabled — no session was ever created to send into.
    expect(screen.getByRole('button', { name: '送出回答' })).toBeDisabled();
  });

  it('calls mcqRescueStart and renders the AI opening message when AI is on', async () => {
    stubFeaturesFetch(true);
    const startSpy = vi.spyOn(learningApi, 'mcqRescueStart').mockResolvedValue({
      session_id: 'mcq_rescue_1_q1',
      ai_first_message: '我們來想想看這題為什麼選 B 喔！',
      current_step: 1,
    });

    render(
      <McqRescueDialog isOpen={true} context={CONTEXT} onClose={() => {}} />,
    );

    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText('我們來想想看這題為什麼選 B 喔！')).toBeInTheDocument(),
    );
    expect(screen.queryByText('AI 功能暫時關閉')).not.toBeInTheDocument();
  });
});
