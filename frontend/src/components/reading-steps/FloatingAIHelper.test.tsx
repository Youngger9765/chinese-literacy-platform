/**
 * Tests for FloatingAIHelper's chatbot kill switch behavior (#3861).
 *
 * FloatingAIHelper IS the chatbot / "ask the AI" conversational entry point:
 * it is the free-form chat UI that calls /api/comprehension/chat. #3861
 * scope-corrected the #3838 kill switch so the general AI gate defaults ON
 * (reading transcription, OMO grading, etc. work again) but the chatbot
 * surface stays OFF by default — this component must hide itself whenever
 * useAiChatbotEnabled() reports false, independent of the pre-existing
 * FLOATING_AI_HELPER_ENABLED=false product toggle (#1707) that already
 * hides it today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FloatingAIHelper from './FloatingAIHelper';
import * as learningApi from '../../services/learningApi';
import { _resetAiFeaturesCacheForTests } from '../../hooks/useAiFeaturesEnabled';

vi.mock('../../contexts/AuthContext', async () => {
  const fake = { token: 'test-token', user: { id: 1, name: '小明', role: 'student' } };
  return { useAuth: () => fake };
});

function stubFeaturesFetch(aiChatbotEnabled: boolean, aiFeaturesEnabled = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/api/features')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ai_features_enabled: aiFeaturesEnabled, ai_chatbot_enabled: aiChatbotEnabled }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  );
}

describe('FloatingAIHelper — chatbot kill switch (#3861)', () => {
  beforeEach(() => {
    _resetAiFeaturesCacheForTests();
    // The dialogue-history rehydration effect runs regardless of whether the
    // component ends up rendering anything (hooks run before the early
    // `return null`) — stub it so it never hits a real network call.
    vi.spyOn(learningApi, 'fetchDialogueHistory').mockResolvedValue({
      session_id: 1,
      story_slug: null,
      turns: [],
      total: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAiFeaturesCacheForTests();
  });

  it('renders nothing when chatbot is disabled (the production default)', async () => {
    stubFeaturesFetch(false);
    const { container } = render(
      <FloatingAIHelper storyTitle="測試課文" storyText="內容" dbSessionId={1} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTitle('打開 AI 小助手')).not.toBeInTheDocument();
  });

  it('still renders nothing even when chatbot is enabled server-side, because the pre-existing FLOATING_AI_HELPER_ENABLED=false (#1707) product toggle also gates it', async () => {
    stubFeaturesFetch(true);
    const { container } = render(
      <FloatingAIHelper storyTitle="測試課文" storyText="內容" dbSessionId={1} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('never calls the chat endpoint when hidden', async () => {
    stubFeaturesFetch(false);
    const sendSpy = vi.spyOn(learningApi, 'sendComprehensionChat');
    render(<FloatingAIHelper storyTitle="測試課文" storyText="內容" dbSessionId={1} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
