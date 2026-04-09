/**
 * SessionHistoryReportPage — shows a historical session in two tabs:
 *   1. 學習報告 — overall AssessmentReport (existing)
 *   2. 作答紀錄 — per-step answer records (reading errors, dialogue Q&A, vocab, full-reading diff)
 *
 * Route: /sessions/:sessionId/report
 * Issue #580 + feattodo new requirement
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import {
  fetchSessionReport,
  fetchDialogueHistory,
  type SessionDetailResponse,
  type ComprehensionScoreResult,
  type DialogueTurnItem,
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
import DiffDisplay from '../../components/ui/DiffDisplay';
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
    diffTokens: Array.isArray(raw.diff_tokens) ? (raw.diff_tokens as DiffToken[]) : undefined,
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
// Section wrapper
// ---------------------------------------------------------------------------

const StepSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white rounded-2xl shadow-card p-4 space-y-3">
    <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2">{title}</h3>
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// 逐段朗讀 record
// ---------------------------------------------------------------------------

const ReadingRecord: React.FC<{ raw: Record<string, unknown> }> = ({ raw }) => {
  const accuracy = typeof raw.accuracy === 'number' ? Math.round(raw.accuracy * 100) : null;
  const cpm = typeof raw.cpm === 'number' ? raw.cpm : null;
  const mispronounced = Array.isArray(raw.mispronounced_words) ? (raw.mispronounced_words as string[]) : [];
  const transcription = typeof raw.transcription === 'string' ? raw.transcription : null;

  return (
    <StepSection title="逐段朗讀">
      <div className="flex gap-4 flex-wrap text-sm">
        {accuracy != null && (
          <div>
            <span className="text-xs text-gray-500">準確率</span>
            <p className="font-semibold text-gray-800">{accuracy}%</p>
          </div>
        )}
        {cpm != null && (
          <div>
            <span className="text-xs text-gray-500">語速 (CPM)</span>
            <p className="font-semibold text-gray-800">{cpm}</p>
          </div>
        )}
      </div>
      {mispronounced.length > 0 ? (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">念錯的字詞</p>
          <div className="flex flex-wrap gap-1.5">
            {mispronounced.map((w, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-sm font-medium">
                {w}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-green-600">沒有念錯的字詞</p>
      )}
      {transcription && (
        <div>
          <p className="text-xs text-gray-500 mb-1">辨識文字</p>
          <p className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-lg p-2.5 whitespace-pre-wrap">
            {transcription}
          </p>
        </div>
      )}
    </StepSection>
  );
};

// ---------------------------------------------------------------------------
// 全文朗讀 record
// ---------------------------------------------------------------------------

const FullReadingRecord: React.FC<{ raw: Record<string, unknown> }> = ({ raw }) => {
  const matchRate = typeof raw.match_rate === 'number' ? Math.round(raw.match_rate * 100) : null;
  const cpm = typeof raw.cpm === 'number' ? raw.cpm : null;
  const feedback = typeof raw.feedback === 'string' ? raw.feedback : null;
  const diffTokens = Array.isArray(raw.diff_tokens) ? (raw.diff_tokens as DiffToken[]) : [];
  const errorBreakdown = raw.error_breakdown && typeof raw.error_breakdown === 'object'
    ? (raw.error_breakdown as { correct: number; wrong: number; missing: number; extra: number })
    : null;

  return (
    <StepSection title="全文朗讀">
      <div className="flex gap-4 flex-wrap text-sm">
        {matchRate != null && (
          <div>
            <span className="text-xs text-gray-500">符合率</span>
            <p className="font-semibold text-gray-800">{matchRate}%</p>
          </div>
        )}
        {cpm != null && (
          <div>
            <span className="text-xs text-gray-500">語速 (CPM)</span>
            <p className="font-semibold text-gray-800">{cpm}</p>
          </div>
        )}
      </div>
      {errorBreakdown && (
        <div className="flex gap-3 flex-wrap text-xs">
          <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">正確 {errorBreakdown.correct}</span>
          <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">錯誤 {errorBreakdown.wrong}</span>
          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600">漏讀 {errorBreakdown.missing}</span>
          <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700">多讀 {errorBreakdown.extra}</span>
        </div>
      )}
      {diffTokens.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">朗讀差異對照</p>
          <div className="text-base leading-loose bg-gray-50 rounded-lg p-3">
            <DiffDisplay tokens={diffTokens} showLegend />
          </div>
        </div>
      )}
      {feedback && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs font-medium text-blue-700 mb-0.5">AI 回饋</p>
          <p className="text-sm text-gray-700 leading-relaxed">{feedback}</p>
        </div>
      )}
    </StepSection>
  );
};

// ---------------------------------------------------------------------------
// 課文理解 dialogue record
// ---------------------------------------------------------------------------

const ComprehensionRecord: React.FC<{
  raw: Record<string, unknown> | null;
  turns: DialogueTurnItem[];
  scores: ComprehensionScoreResult | null;
}> = ({ raw, turns, scores }) => {
  const understood = raw && typeof raw.understood_count === 'number' ? raw.understood_count : null;
  const required = raw && typeof raw.required_count === 'number' ? raw.required_count : null;

  // Only show ai + student turns (skip feedback role for readability)
  const conversationTurns = turns.filter((t) => t.role === 'ai' || t.role === 'student');

  return (
    <StepSection title="課文理解">
      {(understood != null || scores) && (
        <div className="flex gap-4 flex-wrap text-sm">
          {understood != null && required != null && (
            <div>
              <span className="text-xs text-gray-500">答對題數</span>
              <p className="font-semibold text-gray-800">{understood} / {required}</p>
            </div>
          )}
          {scores && (
            <>
              <div>
                <span className="text-xs text-gray-500">理解總分</span>
                <p className="font-semibold text-gray-800">{Math.round(scores.comprehension_score * 100)}%</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">字面</span>
                <p className="font-semibold text-gray-800">{Math.round(scores.literal_score * 100)}%</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">推論</span>
                <p className="font-semibold text-gray-800">{Math.round(scores.inferential_score * 100)}%</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">評鑑</span>
                <p className="font-semibold text-gray-800">{Math.round(scores.evaluative_score * 100)}%</p>
              </div>
            </>
          )}
        </div>
      )}

      {conversationTurns.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {conversationTurns.map((turn) => (
            <div
              key={turn.id}
              className={`flex ${turn.role === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  turn.role === 'ai'
                    ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    : turn.is_correct === false
                      ? 'bg-red-100 text-red-800 rounded-tr-sm'
                      : 'bg-accent-bg text-accent rounded-tr-sm'
                }`}
              >
                {turn.text}
                {turn.role === 'student' && turn.is_correct === false && (
                  <span className="block text-xs text-red-500 mt-0.5">✗ 答錯</span>
                )}
                {turn.role === 'student' && turn.is_correct === true && (
                  <span className="block text-xs text-green-600 mt-0.5">✓ 答對</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400">沒有對話紀錄</p>
      )}

      {scores?.feedback.overall && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
          <p className="text-xs font-medium text-emerald-700 mb-0.5">AI 整體回饋</p>
          <p className="text-sm text-gray-700 leading-relaxed">{scores.feedback.overall}</p>
        </div>
      )}
    </StepSection>
  );
};

// ---------------------------------------------------------------------------
// 生字練習 record
// ---------------------------------------------------------------------------

const VocabRecord: React.FC<{ raw: Record<string, unknown> }> = ({ raw }) => {
  const words = Array.isArray(raw.practiced_words)
    ? (raw.practiced_words as string[])
    : Array.isArray(raw.practiced_chars)
      ? (raw.practiced_chars as string[])
      : [];
  const total = typeof raw.total_words === 'number' ? raw.total_words
    : typeof raw.total_chars === 'number' ? raw.total_chars : 0;

  return (
    <StepSection title="生字練習">
      <div className="text-sm">
        <span className="text-xs text-gray-500">練習進度</span>
        <p className="font-semibold text-gray-800">{words.length} / {total} 個生字</p>
      </div>
      {words.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">已練習的生字</p>
          <div className="flex flex-wrap gap-2">
            {words.map((w, i) => (
              <span key={i} className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-base font-medium">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
    </StepSection>
  );
};

// ---------------------------------------------------------------------------
// 作答紀錄 tab — all step records
// ---------------------------------------------------------------------------

const StepRecordsView: React.FC<{
  detail: SessionDetailResponse;
  comprehensionScores: ComprehensionScoreResult | null;
  token: string;
  sessionId: number;
}> = ({ detail, comprehensionScores, token, sessionId }) => {
  const [turns, setTurns] = useState<DialogueTurnItem[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(false);

  useEffect(() => {
    if (!detail.comprehension_result) return;
    setLoadingTurns(true);
    fetchDialogueHistory(token, sessionId)
      .then((r) => setTurns(r.turns))
      .catch(() => {/* non-critical */})
      .finally(() => setLoadingTurns(false));
  }, [token, sessionId, detail.comprehension_result]);

  const hasReading = !!detail.reading_result;
  const hasFullReading = !!detail.full_reading_result;
  const hasComprehension = !!detail.comprehension_result;
  const hasVocab = !!detail.vocab_result;
  const hasAny = hasReading || hasFullReading || hasComprehension || hasVocab;

  if (!hasAny) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">這筆紀錄沒有儲存作答內容</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasReading && (
        <ReadingRecord raw={detail.reading_result!} />
      )}
      {hasFullReading && (
        <FullReadingRecord raw={detail.full_reading_result!} />
      )}
      {hasComprehension && (
        loadingTurns
          ? <div className="bg-white rounded-2xl shadow-card p-4">
              <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3 mb-3" />
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-gray-100 animate-pulse rounded-xl" />)}
              </div>
            </div>
          : <ComprehensionRecord
              raw={detail.comprehension_result}
              turns={turns}
              scores={comprehensionScores}
            />
      )}
      {hasVocab && (
        <VocabRecord raw={detail.vocab_result!} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

type PageTab = 'report' | 'steps';

const SessionHistoryReportPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [comprehensionScores, setComprehensionScores] = useState<ComprehensionScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<PageTab>('report');

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
      .then(async (d) => {
        setDetail(d);
        setSession(buildLearningSession(d));
        setComprehensionScores(buildComprehensionScores(d));

        if (d.story_slug) {
          try {
            setStory(await fetchStory(d.story_slug));
          } catch {
            // non-critical
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
            onClick={() => navigate('/learning-history')}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            返回學習記錄
          </button>
        </div>
      </div>
    );
  }

  const teacherReviewedAt = detail?.teacher_reviewed_at ?? null;
  const teacherComment = detail?.teacher_comment ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 space-y-4">

        {/* Teacher review banner */}
        {teacherReviewedAt && (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              老師已查看（{new Date(teacherReviewedAt).toLocaleDateString('zh-TW')}）
            </div>
            {teacherComment && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-purple-700 mb-1">老師評語</p>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{teacherComment}</p>
              </div>
            )}
          </div>
        )}

        {/* Tab nav */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px" aria-label="檢視模式">
            {([
              { key: 'report', label: '學習報告' },
              { key: 'steps', label: '作答紀錄' },
            ] as { key: PageTab; label: string }[]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'report' ? (
          <AssessmentReport
            session={session}
            story={story}
            onRetry={() => navigate('/learning-history')}
            dbSessionId={sessionId ? Number(sessionId) : null}
            token={token}
            comprehensionScores={comprehensionScores}
          />
        ) : (
          detail && (
            <StepRecordsView
              detail={detail}
              comprehensionScores={comprehensionScores}
              token={token!}
              sessionId={Number(sessionId)}
            />
          )
        )}
      </div>
    </div>
  );
};

export default SessionHistoryReportPage;
