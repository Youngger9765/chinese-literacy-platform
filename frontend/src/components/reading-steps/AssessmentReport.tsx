
import React, { useState, useEffect } from 'react';
import { LearningSession } from '../../types';
import type { Story } from '../../types';
import type { ComprehensionScoreResult } from '../../services/learningApi';
import { getReadingHistory, type ReadingHistoryPoint } from '../../services/learningApi';
import CelebrationOverlay from '../ui/CelebrationOverlay';
import ExitTicket from './ExitTicket';
import { trackLearningEvent } from '../../utils/analytics';
import StarCelebration from '../gamification/StarCelebration';
import { calcStarRating } from '../../utils/starRatingCalc';
import RepeatedErrorAlertModal from '../student/RepeatedErrorAlertModal';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import { encourageOverall } from '../../utils/encouragement';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

// Extracted modules (#1845)
import { computeReportMetrics, reportViewedKey } from './assessmentReportMetrics';
import AssessmentReadingSummary from './AssessmentReadingSummary';
import AssessmentDiffSection from './AssessmentDiffSection';
import {
  AssessmentComprehensionSection,
  AssessmentLegacyResults,
} from './AssessmentComprehensionSection';
import { useRepeatedErrorAlerts } from './useRepeatedErrorAlerts';

// Extracted section components (#1945)
import AssessmentSectionWrapper from './AssessmentSectionWrapper';
import IntelligentAnalysisSection from './IntelligentAnalysisSection';
import ErrorWordListSection from './ErrorWordListSection';
import PracticeRecommendationSection from './PracticeRecommendationSection';

interface AssessmentReportProps {
  session: LearningSession | null;
  story?: Story | null;
  onRetry: () => void;
  onGoToVocab?: () => void;
  comprehensionScores?: ComprehensionScoreResult | null;
  comprehensionScoresLoading?: boolean;
  /** Reading goals from assignment, if student is doing an assignment (Issue #84) */
  readingGoals?: { effectiveCpm: number; effectiveAccuracy: number; difficultyLabel?: string | null } | null;
  /** DB session ID — passed to ExitTicket for AI generation and persistence (Issue #463) */
  dbSessionId?: number | null;
  /** Auth token — passed to ExitTicket for API calls (Issue #463) */
  token?: string | null;
  /** When true, suppresses celebration overlays and interactive elements (teacher view) */
  readOnly?: boolean;
}

/** Generate practice suggestions based on performance */
const generateSuggestions = (
  wrongTokens: { char: string; expected: string }[],
  accuracy: number,
  cpm: number,
): { icon: string; title: string; desc: string }[] => {
  const suggestions: { icon: string; title: string; desc: string }[] = [];

  if (wrongTokens.length > 0) {
    suggestions.push({ icon: '🔊', title: '聽正確發音', desc: '點擊上方錯字詞旁的喇叭按鈕，反覆聆聽正確讀法。' });
  }
  if (accuracy < 80) {
    suggestions.push({ icon: '🔄', title: '反覆練習錯誤詞語', desc: '把讀錯的字詞抄寫三遍，邊寫邊唸出聲音。' });
  }
  if (cpm > 180 && accuracy < 70) {
    suggestions.push({ icon: '🐢', title: '放慢語速', desc: '你讀得很快但準確度不夠，試著放慢速度，把每個字唸清楚。' });
  } else if (cpm < 90) {
    suggestions.push({ icon: '⏱️', title: '提升朗讀速度', desc: '多朗讀幾次同一篇文章，熟悉內容後速度自然會加快。' });
  }
  suggestions.push({ icon: '📈', title: '追蹤改進', desc: '重新朗讀一次，看看這次能不能比上次進步！' });

  return suggestions.slice(0, 4);
};

const AssessmentReport: React.FC<AssessmentReportProps> = ({
  session,
  story,
  onRetry,
  onGoToVocab,
  comprehensionScores,
  comprehensionScoresLoading,
  readingGoals,
  dbSessionId,
  token,
  readOnly,
}) => {
  // ── Metrics (pure computation, no side effects) ──────────────────────────
  const {
    hideScores,
    hasNoData,
    completedSections,
    overallScore,
    segmentStats,
    wrongTokens,
    missingChars,
    bestReadingAccuracy,
    comprehensionPct,
    hasReadingData,
  } = computeReportMetrics(session, readOnly, comprehensionScores);

  // ── Track report viewed in localStorage ──────────────────────────────────
  useEffect(() => {
    if (!story?.id) return;
    try {
      localStorage.setItem(reportViewedKey(scopedStepStorageKey, story.id), JSON.stringify({
        viewed: true,
        viewedAt: new Date().toISOString(),
        sessionId: dbSessionId,
      }));
    } catch {}
  }, [story?.id, dbSessionId]);

  // ── Reading history for progress curve (#909) ────────────────────────────
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryPoint[]>([]);
  useEffect(() => {
    if (!token || !story?.id || !hasReadingData) return;
    getReadingHistory(token, String(story.id)).then(setReadingHistory).catch(() => {});
  }, [token, story?.id, hasReadingData]);

  // ── Repeated error alerts (Issue #248) ───────────────────────────────────
  const { repeatedAlerts, showRepeatedAlert, dismissAlert } = useRepeatedErrorAlerts(
    token,
    dbSessionId,
    hasReadingData,
  );

  // ── Track lesson completion ───────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const { readingAttempt, comprehensionResult, vocabResult, fullReadingResult } = session;
    if (!readingAttempt && !comprehensionResult && !vocabResult && !fullReadingResult) return;
    trackLearningEvent('complete_lesson', {
      story_id: story?.id ?? '',
      story_title: story?.title ?? '',
    });
  // Fire once per story session — storyId + startedAt identifies a unique session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.storyId, session?.startedAt]);

  // ── Shortcuts ────────────────────────────────────────────────────────────
  const { readingAttempt, dictationResult, fullReadingResult, comprehensionResult } =
    session ?? {
      readingAttempt: null,
      comprehensionResult: null,
      vocabResult: null,
      dictationResult: null,
      fullReadingResult: null,
    };

  const lineBreakdown = readingAttempt?.lineBreakdown ?? [];
  const cpm = readingAttempt?.cpm ?? 0;
  const accuracy = readingAttempt?.accuracy ?? 0;
  const suggestions = readingAttempt ? generateSuggestions(wrongTokens, accuracy, cpm) : [];

  // Transcription from readingAttempt or fullReadingResult
  const transcription =
    (readingAttempt?.transcription ?? '').trim() ||
    (fullReadingResult?.transcript ?? '').trim();

  const starCount = calcStarRating({
    readingAccuracy: bestReadingAccuracy,
    comprehensionScore: comprehensionPct,
  });

  // ── No session guard ─────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center gap-6 py-24 text-center">
        <p className="text-gray-500 text-lg">請先選擇課文開始學習</p>
        <button onClick={onRetry} className="bg-accent hover:bg-accent-hover text-white px-6 py-2.5 rounded-full text-sm font-bold transition-all">
          回圖書館
        </button>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
      {/* Repeated error alert modal (Issue #248) */}
      {showRepeatedAlert && repeatedAlerts.length > 0 && (
        <RepeatedErrorAlertModal
          alerts={repeatedAlerts}
          onDismiss={dismissAlert}
        />
      )}

      {!readOnly && !hasNoData && <CelebrationOverlay score={overallScore} />}

      {/* ============ 星星評級 Star Rating (Issue #222) —
          學生端隱藏（Issue #1094：改鼓勵式，不呈現星星/分數） ============ */}
      {!hasNoData && !hideScores && (
        <StarCelebration
          stars={starCount}
          readingAccuracy={bestReadingAccuracy}
          comprehensionScore={comprehensionPct}
        />
      )}

      {/* Progress indicator — shown when not all sections are complete */}
      {hasNoData ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
          <p className="text-2xl mb-2">📖</p>
          <h2 className="text-lg font-bold text-amber-900 mb-1">還沒有完成朗讀練習喔！</h2>
          <p className="text-sm text-amber-700 mb-3">完成「逐段朗讀」或「全文朗讀」後，這裡會顯示你的完整學習報告。</p>
          <button
            onClick={onRetry}
            className="bg-accent hover:bg-accent-hover text-white px-6 py-2 rounded-full text-sm font-bold transition-all"
          >
            回到課文
          </button>
        </div>
      ) : completedSections < 6 ? (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-3 flex items-center gap-3">
          <div className="flex gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all ${i < completedSections ? 'w-6 bg-accent' : 'w-4 bg-gray-200'}`}
              />
            ))}
          </div>
          <p className="text-sm text-blue-700 font-medium">
            已完成 <span className="font-black">{completedSections}</span> / 6 環節
          </p>
        </div>
      ) : null}

      {/* Header */}
      <div className="text-center">
        {hasNoData ? null : (
          <div className="inline-block bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm font-bold mb-4">
            恭喜完成練習！
          </div>
        )}
        <h2 className="text-4xl font-bold mb-2">
          {hasNoData ? '學習報告預覽' : '好棒！你今天又進步了。'}
        </h2>
        <p className="text-gray-500">
          {hasNoData ? '完成各環節後，這裡會顯示你的詳細成果。' : '讓我們看看這次學習的完整成果吧。'}
        </p>
        {story && (
          <p className="text-sm text-gray-400 mt-1">{story.title}</p>
        )}
        {overallScore !== null ? (
          hideScores ? (
            <div className="mt-4 inline-flex items-center gap-2 bg-accent/10 text-accent px-5 py-2 rounded-full">
              <span className="text-sm font-bold">{encourageOverall(overallScore)}</span>
            </div>
          ) : (
            <div className="mt-4 inline-flex items-center gap-2 bg-accent/10 text-accent px-5 py-2 rounded-full">
              <span className="text-sm font-bold">綜合成績</span>
              <span className="text-2xl font-black">{overallScore}%</span>
            </div>
          )
        ) : !hideScores ? (
          <div className="mt-4 inline-flex items-center gap-2 bg-gray-100 text-gray-400 px-5 py-2 rounded-full">
            <span className="text-sm font-bold">綜合成績</span>
            <span className="text-2xl font-black">--</span>
          </div>
        ) : null}
      </div>

      {/* ============ 環節一：朗讀結果總覽 ============ */}
      <AssessmentSectionWrapper number={1} title="朗讀結果總覽" defaultOpen={true} disabled={!readingAttempt && !fullReadingResult}>
        <AssessmentReadingSummary
          readingAttempt={readingAttempt}
          fullReadingResult={fullReadingResult}
          hideScores={hideScores}
          story={story}
          readingGoals={readingGoals}
        />
      </AssessmentSectionWrapper>

      {/* ============ 環節二：錄音內容與智能分析 ============ */}
      <AssessmentSectionWrapper number={2} title="錄音內容與智能分析" defaultOpen={false} disabled={!readingAttempt && !fullReadingResult}>
        <IntelligentAnalysisSection
          transcription={transcription}
          lineBreakdown={lineBreakdown}
          segmentStats={segmentStats}
          hideScores={hideScores}
          hasReadingData={hasReadingData}
        />
      </AssessmentSectionWrapper>

      {/* ============ 環節三：逐句分析對比 ============ */}
      <AssessmentSectionWrapper number={3} title="逐句分析對比" defaultOpen={false} disabled={lineBreakdown.length === 0}>
        <AssessmentDiffSection
          lineBreakdown={lineBreakdown}
          fullReadingResult={fullReadingResult}
          hideScores={hideScores}
        />
      </AssessmentSectionWrapper>

      {/* ============ 環節四：錯字詞練習清單 ============ */}
      <AssessmentSectionWrapper number={4} title="錯字詞練習清單" defaultOpen={true} disabled={wrongTokens.length === 0 && missingChars.length === 0}>
        <ErrorWordListSection
          wrongTokens={wrongTokens}
          missingChars={missingChars}
          onGoToVocab={onGoToVocab}
          hasReadingAttempt={!!readingAttempt}
        />
      </AssessmentSectionWrapper>

      {/* ============ 環節五：練習建議 ============ */}
      <AssessmentSectionWrapper number={5} title="練習建議" defaultOpen={false} disabled={!readingAttempt}>
        <PracticeRecommendationSection
          suggestions={suggestions}
          hasReadingAttempt={!!readingAttempt}
        />
      </AssessmentSectionWrapper>

      {/* ============ 環節六：課文理解力評估 (Issue #243) ============ */}
      <AssessmentSectionWrapper number={6} title="課文理解力評估" defaultOpen={true} disabled={!comprehensionScores && !comprehensionScoresLoading}>
        <AssessmentComprehensionSection
          comprehensionScores={comprehensionScores}
          comprehensionScoresLoading={comprehensionScoresLoading}
          hideScores={hideScores}
        />
      </AssessmentSectionWrapper>

      {/* ============ 補充資訊：聽寫練習 + 課文理解 ============ */}
      {/* vocab (#1333): removed from report — now a standalone practice tool in 練習工具箱. */}
      <AssessmentLegacyResults
        dictationResult={dictationResult}
        comprehensionResult={comprehensionResult}
        hideScores={hideScores}
      />

      {/* ============ 出場卷 Exit Ticket ============ */}
      {(wrongTokens.length > 0 || missingChars.length > 0) && story?.content && (
        <ExitTicket
          wrongTokens={wrongTokens}
          missingChars={missingChars}
          storyContent={story.content}
          dbSessionId={dbSessionId}
          token={token}
        />
      )}

      {/* ============ 朗讀進步曲線 (#909) — 學生端隱藏（Issue #1094，數據曲線屬教師觀察用） ============ */}
      {!hideScores && readingHistory.length >= 2 && (
        <AssessmentSectionWrapper number={8} title="朗讀進步曲線" defaultOpen={true}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              本篇課文已練習 {readingHistory.length} 次，持續練習可以看到明顯進步
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={readingHistory.map((h, i) => ({
                attempt: `第${i + 1}次`,
                cpm: h.cpm,
                accuracy: h.accuracy,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="attempt" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="cpm"
                  tick={{ fontSize: 11 }}
                  width={36}
                  label={{ value: '字/分', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9ca3af' } }}
                />
                <YAxis
                  yAxisId="accuracy"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fontSize: 11 }}
                  width={36}
                  label={{ value: '%', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9ca3af' } }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    name === 'cpm' ? `${value} 字/分` : `${value}%`,
                    name === 'cpm' ? '語速 (CPM)' : '準確度',
                  ]}
                />
                <Legend
                  formatter={(value: string) => value === 'cpm' ? '語速 (CPM)' : '準確度'}
                />
                <Line yAxisId="cpm" type="monotone" dataKey="cpm" stroke="#4A3FA3" strokeWidth={2} dot={{ r: 4 }} name="cpm" />
                <Line yAxisId="accuracy" type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="accuracy" />
                {readingGoals && (
                  <>
                    <Line yAxisId="cpm" type="monotone" dataKey={() => readingGoals.effectiveCpm} stroke="#4A3FA3" strokeWidth={1} strokeDasharray="5 5" dot={false} name="cpm-goal" legendType="none" />
                    <Line yAxisId="accuracy" type="monotone" dataKey={() => readingGoals.effectiveAccuracy} stroke="#10b981" strokeWidth={1} strokeDasharray="5 5" dot={false} name="accuracy-goal" legendType="none" />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
            {readingGoals && (
              <p className="text-xs text-gray-400 text-center">
                虛線 = 目標值（CPM {readingGoals.effectiveCpm}，準確度 {readingGoals.effectiveAccuracy}%）
              </p>
            )}
          </div>
        </AssessmentSectionWrapper>
      )}

      {/* CTA */}
      <div className="bg-gradient-to-r from-accent to-violet-600 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div>
          <h3 className="text-2xl font-bold">準備好讀下一個故事了嗎？</h3>
          <p className="text-white/80">每天進步一點點，你就會變成閱讀小達人！</p>
        </div>
        <button onClick={onRetry} className="bg-white text-accent px-6 py-2.5 rounded-full text-sm font-bold hover:shadow-lg transition-all">
          回圖書館
        </button>
      </div>
    </div>
  );
};

export default AssessmentReport;
