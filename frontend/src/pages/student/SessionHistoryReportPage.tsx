/**
 * SessionHistoryReportPage — shows AssessmentReport for a historical session.
 *
 * Unlike ReportPage (which reads live session data from LearningContext),
 * this page fetches the persisted session data from
 * GET /api/learning/sessions/:sessionId/report and reconstructs a
 * LearningSession-shaped object so that AssessmentReport can render it.
 *
 * Route: /sessions/:sessionId/report
 * Issue #580
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import {
  fetchSessionReport,
  type SessionDetailResponse,
  type ComprehensionScoreResult,
} from '../../services/learningApi';
import type {
  LearningSession,
  ReadingAttempt,
  ComprehensionResult,
  VocabResult,
  FullReadingResult,
  DiffToken,
  Story,
} from '../../types';
import AssessmentReport from '../../components/reading-steps/AssessmentReport';
import PageLoader from '../../components/ui/PageLoader';

// ---------------------------------------------------------------------------
// Helpers — map raw backend dicts to frontend types
// ---------------------------------------------------------------------------

function toReadingAttempt(raw: Record<string, unknown> | null, storyId: string): ReadingAttempt | null {
  if (!raw) return null;
  return {
    storyId,
    accuracy: typeof raw.accuracy === 'number' ? raw.accuracy : 0,
    fluency: typeof raw.fluency === 'number' ? raw.fluency : 0,
    cpm: typeof raw.cpm === 'number' ? raw.cpm : 0,
    mispronouncedWords: Array.isArray(raw.mispronounced_words)
      ? (raw.mispronounced_words as string[])
      : [],
    transcription: typeof raw.transcription === 'string' ? raw.transcription : '',
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    // diff_tokens stored as-is — AssessmentReport uses DiffDisplay internally
    lineBreakdown: undefined,
  };
}

function toComprehensionResult(raw: Record<string, unknown> | null): ComprehensionResult | null {
  if (!raw) return null;
  return {
    understoodCount:
      typeof raw.understood_count === 'number' ? raw.understood_count : 0,
    requiredCount:
      typeof raw.required_count === 'number' ? raw.required_count : 0,
    isComplete: raw.is_complete === true,
    conversationLength:
      typeof raw.conversation_length === 'number' ? raw.conversation_length : 0,
  };
}

function toVocabResult(raw: Record<string, unknown> | null): VocabResult | null {
  if (!raw) return null;
  return {
    practicedChars: Array.isArray(raw.practiced_chars)
      ? (raw.practiced_chars as string[])
      : [],
    totalChars: typeof raw.total_chars === 'number' ? raw.total_chars : 0,
  };
}

function toFullReadingResult(raw: Record<string, unknown> | null): FullReadingResult | null {
  if (!raw) return null;
  return {
    matchRate: typeof raw.match_rate === 'number' ? raw.match_rate : 0,
    feedback: typeof raw.feedback === 'string' ? raw.feedback : '',
    cpm: typeof raw.cpm === 'number' ? raw.cpm : undefined,
    durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined,
    errorBreakdown:
      raw.error_breakdown && typeof raw.error_breakdown === 'object'
        ? (raw.error_breakdown as { correct: number; wrong: number; missing: number; extra: number })
        : undefined,
    diffTokens: Array.isArray(raw.diff_tokens)
      ? (raw.diff_tokens as DiffToken[])
      : undefined,
    transcript: typeof raw.transcript === 'string' ? raw.transcript : undefined,
  };
}

function buildLearningSession(detail: SessionDetailResponse): LearningSession {
  const storyId = detail.story_slug ?? '';
  return {
    storyId,
    startedAt: new Date(detail.started_at).getTime(),
    introCompleted: detail.current_step > 1,
    readingAttempt: toReadingAttempt(detail.reading_result, storyId),
    comprehensionResult: toComprehensionResult(detail.comprehension_result),
    vocabResult: toVocabResult(detail.vocab_result),
    dictationResult: null,
    fullReadingResult: toFullReadingResult(detail.full_reading_result),
  };
}

function buildComprehensionScores(detail: SessionDetailResponse): ComprehensionScoreResult | null {
  if (detail.comprehension_score == null) return null;
  return {
    comprehension_score: detail.comprehension_score,
    literal_score: detail.literal_score ?? 0,
    inferential_score: detail.inferential_score ?? 0,
    evaluative_score: detail.evaluative_score ?? 0,
    feedback: {
      literal: '',
      inferential: '',
      evaluative: '',
      overall: detail.comprehension_feedback ?? '',
    },
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const SessionHistoryReportPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<LearningSession | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [comprehensionScores, setComprehensionScores] = useState<ComprehensionScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !sessionId) return;
    const id = Number(sessionId);
    if (isNaN(id)) {
      setError('無效的記錄 ID');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    fetchSessionReport(token, id)
      .then(async (detail) => {
        setSession(buildLearningSession(detail));
        setComprehensionScores(buildComprehensionScores(detail));

        // Try to load the Story for AssessmentReport (best-effort — non-blocking)
        if (detail.story_slug) {
          try {
            const s = await fetchStory(detail.story_slug);
            setStory(s);
          } catch {
            // Non-critical — AssessmentReport gracefully handles story=null
          }
        }
      })
      .catch((err: Error) => {
        setError(err.message || '無法載入學習報告');
      })
      .finally(() => setIsLoading(false));
  }, [token, sessionId]);

  if (isLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={() => navigate('/history')}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            返回學習記錄
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      <AssessmentReport
        session={session}
        story={story}
        onRetry={() => navigate('/history')}
        dbSessionId={sessionId ? Number(sessionId) : null}
        token={token}
        comprehensionScores={comprehensionScores}
      />
    </div>
  );
};

export default SessionHistoryReportPage;
