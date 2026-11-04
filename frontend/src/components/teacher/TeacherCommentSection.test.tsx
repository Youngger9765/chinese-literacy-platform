/**
 * Tests for TeacherCommentSection's AI kill switch behavior (Issue #3838).
 *
 * The "AI 建議評語" box is the only AI entry point in this component (the
 * teacher's own editable comment textarea is not an AI feature and must
 * keep working regardless of the flag).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import TeacherCommentSection from './TeacherCommentSection';
import * as teacherApi from '../../services/teacherApi';
import { _resetAiFeaturesCacheForTests } from '../../hooks/useAiFeaturesEnabled';

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

describe('TeacherCommentSection — AI kill switch (#3838)', () => {
  beforeEach(() => {
    _resetAiFeaturesCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAiFeaturesCacheForTests();
  });

  it('does not call generateAIComment and shows the disabled notice when AI is off', async () => {
    stubFeaturesFetch(false);
    const generateSpy = vi.spyOn(teacherApi, 'generateAIComment');

    render(
      <TeacherCommentSection
        studentId={1}
        sessionId={1}
        token="t"
        aiComment={null}
        teacherComment={null}
        teacherReviewedAt={null}
        studentName="小明"
      />,
    );

    const aiBox = within(await screen.findByTestId('ai-comment-box'));
    await waitFor(() => expect(aiBox.getByText('AI 功能暫時關閉')).toBeInTheDocument());
    expect(generateSpy).not.toHaveBeenCalled();
    // The regenerate button is an AI entry point — must not render while off.
    expect(aiBox.queryByRole('button', { name: /重新產生|產生中/ })).not.toBeInTheDocument();
    // The teacher's own comment field is NOT an AI feature and must still work.
    expect(screen.getByLabelText('你的評語')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存評語' })).toBeInTheDocument();
  });

  it('calls generateAIComment and renders the regenerate button when AI is on', async () => {
    stubFeaturesFetch(true);
    const generateSpy = vi
      .spyOn(teacherApi, 'generateAIComment')
      .mockResolvedValue({ ai_comment: '小明這週朗讀進步很多！' });

    render(
      <TeacherCommentSection
        studentId={1}
        sessionId={1}
        token="t"
        aiComment={null}
        teacherComment={null}
        teacherReviewedAt={null}
        studentName="小明"
      />,
    );

    await waitFor(() => expect(generateSpy).toHaveBeenCalledWith('t', 1, 1));
    const aiBox = within(screen.getByTestId('ai-comment-box'));
    await waitFor(() =>
      expect(aiBox.getByText('小明這週朗讀進步很多！')).toBeInTheDocument(),
    );
    expect(aiBox.getByRole('button', { name: '重新產生' })).toBeInTheDocument();
    expect(aiBox.queryByText('AI 功能暫時關閉')).not.toBeInTheDocument();
  });

  it('does not auto-generate when a cached AI comment already exists, regardless of flag', async () => {
    stubFeaturesFetch(false);
    const generateSpy = vi.spyOn(teacherApi, 'generateAIComment');

    render(
      <TeacherCommentSection
        studentId={1}
        sessionId={1}
        token="t"
        aiComment="已經有評語了"
        teacherComment={null}
        teacherReviewedAt={null}
        studentName="小明"
      />,
    );

    const aiBox = within(await screen.findByTestId('ai-comment-box'));
    await waitFor(() => expect(aiBox.getByText('AI 功能暫時關閉')).toBeInTheDocument());
    expect(generateSpy).not.toHaveBeenCalled();
    // The AI box shows the disabled notice even when a cached AI comment
    // exists (a deliberate, conservative choice during an active security
    // incident — hide AI-sourced content there, not just block new calls).
    // The teacher's own draft textarea pre-filling from that same cached
    // text is unrelated — it's a non-AI field and keeps working.
    expect(aiBox.queryByText('已經有評語了')).not.toBeInTheDocument();
  });
});
