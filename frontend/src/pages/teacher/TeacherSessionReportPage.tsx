/**
 * TeacherSessionReportPage — teacher view of a student's learning session report.
 *
 * Reuses AssessmentReport (read-only) and adds TeacherCommentSection for
 * AI-generated + teacher-editable feedback.
 *
 * Route: /teacher/students/:studentId/sessions/:sessionId/report
 * Issue #993
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import {
  fetchTeacherSessionReport,
  type TeacherSessionReport,
} from '../../services/teacherApi';
import type {
  LearningSession,
  ReadingAttempt,
  ComprehensionResult,
  VocabResult,
  FullReadingResult,
  DiffToken,
  Story,
} from '../../types';
import type { ComprehensionScoreResult } from '../../services/learningApi';
import AssessmentReport from '../../components/reading-steps/AssessmentReport';
import TeacherCommentSection from '../../components/teacher/TeacherCommentSection';
import PageLoader from '../../components/ui/PageLoader';

// ---------------------------------------------------------------------------
// Helpers — map raw backend dicts to frontend types
// (Same as SessionHistoryReportPage — shared mapping logic)
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
    lineBreakdown: undefined,
  };
}

function toComprehensionResult(raw: Record<string, unknown> | null): ComprehensionResult | null {
  if (!raw) return null;
  return {
    understoodCount: typeof raw.understood_count === 'number' ? raw.understood_count : 0,
    requiredCount: typeof raw.required_count === 'number' ? raw.required_count : 0,
    isComplete: raw.is_complete === true,
    conversationLength: typeof raw.conversation_length === 'number' ? raw.conversation_length : 0,
  };
}

function toVocabResult(raw: Record<string, unknown> | null): VocabResult | null {
  if (!raw) return null;
  const words = Array.isArray(raw.practiced_words)
    ? (raw.practiced_words as string[])
    : Array.isArray(raw.practiced_chars)
      ? (raw.practiced_chars as string[])
      : [];
  const total = typeof raw.total_words === 'number'
    ? raw.total_words
    : typeof raw.total_chars === 'number'
      ? raw.total_chars
      : 0;
  return { practicedWords: words, totalWords: total };
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

function buildSession(detail: TeacherSessionReport): LearningSession {
  const storyId = detail.story_slug ?? '';
  return {
    storyId,
    startedAt: new Date(detail.started_at).getTime(),
    introCompleted: true,
    readingAttempt: toReadingAttempt(detail.reading_result, storyId),
    comprehensionResult: toComprehensionResult(detail.comprehension_result),
    vocabResult: toVocabResult(detail.vocab_result),
    dictationResult: null,
    fullReadingResult: toFullReadingResult(detail.full_reading_result),
  };
}

function buildScores(detail: TeacherSessionReport): ComprehensionScoreResult | null {
  if (detail.comprehension_score == null) return null;

  // comprehension_feedback is stored in the DB as a JSON string (Issue #1245 item 4)
  let feedbackObj: { literal?: string; inferential?: string; evaluative?: string; overall?: string } = {};
  if (detail.comprehension_feedback) {
    try {
      feedbackObj = JSON.parse(detail.comprehension_feedback);
    } catch {
      feedbackObj = { overall: detail.comprehension_feedback };
    }
  }

  return {
    comprehension_score: detail.comprehension_score,
    literal_score: detail.literal_score ?? 0,
    inferential_score: detail.inferential_score ?? 0,
    evaluative_score: detail.evaluative_score ?? 0,
    feedback: {
      literal: feedbackObj.literal ?? '',
      inferential: feedbackObj.inferential ?? '',
      evaluative: feedbackObj.evaluative ?? '',
      overall: feedbackObj.overall ?? '',
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TeacherSessionReportPage: React.FC = () => {
  const { studentId, sessionId } = useParams<{ studentId: string; sessionId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [report, setReport] = useState<TeacherSessionReport | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [scores, setScores] = useState<ComprehensionScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !studentId || !sessionId) return;
    const sid = Number(studentId);
    const sessId = Number(sessionId);
    if (isNaN(sid) || isNaN(sessId)) {
      setError('無效的 ID');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    fetchTeacherSessionReport(token, sid, sessId)
      .then(async (detail) => {
        setReport(detail);
        setSession(buildSession(detail));
        setScores(buildScores(detail));

        if (detail.story_slug) {
          try {
            const s = await fetchStory(detail.story_slug);
            setStory(s);
          } catch {
            // Non-critical
          }
        }
      })
      .catch((err: Error) => {
        setError(err.message || '無法載入學習報告');
      })
      .finally(() => setIsLoading(false));
  }, [token, studentId, sessionId]);

  if (isLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      {/* Header with student name and story */}
      {report && (
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {report.student_name} 的學習報告
            </h1>
            {report.story_title && (
              <p className="text-sm text-gray-500 mt-1">{report.story_title}</p>
            )}
          </div>
          <button
            onClick={() => navigate(-1)}
            className="btn-secondary text-sm"
          >
            返回
          </button>
        </div>
      )}

      {/* Teacher comment section — above report so teacher doesn't scroll past empty sections */}
      {report && token && (
        <TeacherCommentSection
          studentId={Number(studentId)}
          sessionId={Number(sessionId)}
          token={token}
          aiComment={report.ai_comment}
          teacherComment={report.teacher_comment}
          teacherReviewedAt={report.teacher_reviewed_at}
          studentName={report.student_name}
        />
      )}

      {/* Reuse student AssessmentReport (read-only) or show empty message */}
      {report && !report.reading_result && !report.full_reading_result && !report.comprehension_result ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-500">學生尚未完成此課文的學習，暫無報告資料</p>
        </div>
      ) : (
        <AssessmentReport
          session={session}
          story={story}
          onRetry={() => navigate(-1)}
          dbSessionId={sessionId ? Number(sessionId) : null}
          token={token}
          comprehensionScores={scores}
          readOnly
        />
      )}
    </div>
  );
};

export default TeacherSessionReportPage;
