/**
 * Tests for useSentencePracticeState's AI kill switch behavior (Issue #3838).
 *
 * Both fetchExampleSentences and validateSentence are AI generation calls
 * with no non-AI fallback — when the flag is off, neither should be called,
 * and the UI should show "AI 功能暫時關閉" instead of a generic failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSentencePracticeState } from '../useSentencePracticeState';
import * as learningApi from '../../../services/learningApi';
import { _resetAiFeaturesCacheForTests } from '../../../hooks/useAiFeaturesEnabled';

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

describe('useSentencePracticeState — AI kill switch (#3838)', () => {
  beforeEach(() => {
    _resetAiFeaturesCacheForTests();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAiFeaturesCacheForTests();
  });

  it('loadExamples does not call fetchExampleSentences and shows the disabled notice when AI is off', async () => {
    stubFeaturesFetch(false);
    const fetchSpy = vi.spyOn(learningApi, 'fetchExampleSentences');

    const { result } = renderHook(() =>
      useSentencePracticeState({
        practicedWords: ['蘋果'],
        storyTitle: '測試課文',
        storyId: 1,
        token: 't',
      }),
    );

    await act(async () => {
      await result.current.loadExamples();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.currentState.examplesError).toBe('AI 功能暫時關閉');
    expect(result.current.currentState.examplesLoading).toBe(false);
  });

  it('loadExamples calls fetchExampleSentences when AI is on', async () => {
    stubFeaturesFetch(true);
    const fetchSpy = vi.spyOn(learningApi, 'fetchExampleSentences').mockResolvedValue({
      sentences: [{ sentence: '我喜歡吃蘋果。', explanation: '' }],
      source: 'ai',
    });

    const { result } = renderHook(() =>
      useSentencePracticeState({
        practicedWords: ['蘋果'],
        storyTitle: '測試課文',
        storyId: 1,
        token: 't',
      }),
    );

    // useAiFeaturesEnabled starts false and flips true only after its own
    // GET /api/features resolves (a separate effect) — give that a tick to
    // land before calling an imperative function that reads the flag.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      await result.current.loadExamples();
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('t', '蘋果', '測試課文'));
    expect(result.current.currentState.examplesError).toBe('');
  });

  it('handleValidate does not call validateSentence and marks the disabled notice when AI is off', async () => {
    stubFeaturesFetch(false);
    const validateSpy = vi.spyOn(learningApi, 'validateSentence');

    const { result } = renderHook(() =>
      useSentencePracticeState({
        practicedWords: ['蘋果'],
        storyTitle: '測試課文',
        storyId: 1,
        token: 't',
      }),
    );

    act(() => {
      result.current.updateSentenceText(0, '我喜歡吃蘋果');
    });

    await act(async () => {
      await result.current.handleValidate(0);
    });

    expect(validateSpy).not.toHaveBeenCalled();
    expect(result.current.currentState.sentences[0].feedback).toBe('AI 功能暫時關閉');
  });

  it('handleValidate calls validateSentence when AI is on', async () => {
    stubFeaturesFetch(true);
    const validateSpy = vi.spyOn(learningApi, 'validateSentence').mockResolvedValue({
      is_correct: true,
      feedback: '做得好！',
      suggestion: '',
    });

    const { result } = renderHook(() =>
      useSentencePracticeState({
        practicedWords: ['蘋果'],
        storyTitle: '測試課文',
        storyId: 1,
        token: 't',
      }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      result.current.updateSentenceText(0, '我喜歡吃蘋果');
    });

    await act(async () => {
      await result.current.handleValidate(0);
    });

    await waitFor(() => expect(validateSpy).toHaveBeenCalledWith('t', '蘋果', '我喜歡吃蘋果', '測試課文'));
    expect(result.current.currentState.sentences[0].status).toBe('correct');
  });
});
