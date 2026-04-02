
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { speakText as azureSpeakText } from '../../services/ttsApi';
import { LearningSession } from '../../types';
import type { Story } from '../../types';
import type { ComprehensionScoreResult } from '../../services/learningApi';
import { getRepeatedErrorsAlert } from '../../services/progressApi';
import type { RepeatedErrorAlertItem } from '../../services/progressApi';
import DiffDisplay from '../ui/DiffDisplay';
import CelebrationOverlay from '../ui/CelebrationOverlay';
import ComprehensionScoreCard from './ComprehensionScoreCard';
import { CPM_VERY_FAST, CPM_FAST, CPM_MEDIUM, CPM_SLOW } from '../../utils/personaConfig';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { parseReadingBenchmark, getBenchmarkFeedback } from '../../utils/fluencyAnalyzer';
import ExitTicket from './ExitTicket';
import { trackLearningEvent } from '../../utils/analytics';
import AIAnalysisSection from './AIAnalysisSection';
import StarCelebration from '../gamification/StarCelebration';
import { calcStarRating } from '../../utils/starRatingCalc';
import GoalAchievementCard from '../ui/GoalAchievementCard';
import RepeatedErrorAlertModal from '../student/RepeatedErrorAlertModal';
import { getReadingHistory, type ReadingHistoryPoint } from '../../services/learningApi';

/**
 * A wrapper around ResponsiveContainer that only renders the chart
 * once the container has been measured with positive dimensions.
 */
const SafeResponsiveContainer: React.FC<{
  children: React.ReactNode;
  width?: string | number;
  height?: string | number;
}> = ({ children, width = '100%', height = '100%' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (w > 0 && h > 0) setReady(true);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      {ready && (
        <ResponsiveContainer width={width} height={height}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      )}
    </div>
  );
};

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
}

// CPM thresholds aligned with backend persona.py (Issue #54)
const getCpmFeedback = (cpm: number) => {
  if (cpm >= CPM_VERY_FAST) return { text: '非常流利！你讀得又快又準！', level: 'very-fast' };
  if (cpm >= CPM_FAST) return { text: '流利度很好，繼續保持！', level: 'fast' };
  if (cpm >= CPM_MEDIUM) return { text: '速度適中，每天練習會越來越快！', level: 'medium' };
  if (cpm >= CPM_SLOW) return { text: '慢慢來沒關係，多練習就會進步！', level: 'slow' };
  return { text: '不要急，一個字一個字慢慢讀就好！', level: 'very-slow' };
};

const speedSegments = [
  { label: '慢', threshold: CPM_SLOW, color: 'bg-red-400' },
  { label: '適中', threshold: CPM_MEDIUM, color: 'bg-amber-400' },
  { label: '快', threshold: CPM_FAST, color: 'bg-green-400' },
  { label: '很快', threshold: CPM_VERY_FAST, color: 'bg-emerald-400' },
];

const getCurrentSegment = (cpm: number) => {
  if (cpm < CPM_SLOW) return 0;
  if (cpm < CPM_MEDIUM) return 1;
  if (cpm < CPM_FAST) return 2;
  return 3;
};

/** Speak a Chinese character/word using Azure TTS */
const speakText = (text: string) => {
  azureSpeakText(text).catch(() => {});
};

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

/** Section wrapper component for consistent styling, with optional collapse support */
const Section: React.FC<{
  number: number;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
  defaultOpen?: boolean;
}> = ({ number, title, children, disabled, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  const canToggle = !disabled;

  return (
    <div className={`rounded-3xl border overflow-hidden ${disabled ? 'bg-gray-50 border-dashed border-gray-300' : 'bg-white border-slate-200 shadow-sm'}`}>
      <div
        className={`px-6 py-4 flex items-center gap-3 ${disabled ? 'border-gray-200' : 'border-slate-100'} ${open ? 'border-b' : ''} ${canToggle ? 'cursor-pointer select-none hover:bg-slate-50 transition-colors' : ''}`}
        onClick={canToggle ? () => setOpen(o => !o) : undefined}
        role={canToggle ? 'button' : undefined}
        aria-expanded={canToggle ? open : undefined}
      >
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${disabled ? 'bg-gray-200 text-gray-400' : 'bg-accent text-white'}`}>
          {number}
        </span>
        <h3 className={`text-lg font-bold flex-1 ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>{title}</h3>
        {canToggle && (
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {open && (
        <div className="p-6">
          {children}
        </div>
      )}
    </div>
  );
};

const AssessmentReport: React.FC<AssessmentReportProps> = ({ session, story, onRetry, onGoToVocab, comprehensionScores, comprehensionScoresLoading, readingGoals, dbSessionId, token }) => {
  const [expandedLine, setExpandedLine] = useState<number | null>(null);

  // Track report viewed in localStorage
  useEffect(() => {
    if (!story?.id) return;
    try {
      localStorage.setItem(`report_viewed_${story.id}`, JSON.stringify({
        viewed: true,
        viewedAt: new Date().toISOString(),
        sessionId: dbSessionId,
      }));
    } catch {}
  }, [story?.id, dbSessionId]);

  // Reading history for progress curve (#909)
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryPoint[]>([]);
  useEffect(() => {
    if (!token || !story?.id) return;
    getReadingHistory(token, String(story.id)).then(setReadingHistory).catch(() => {});
  }, [token, story?.id]);

  // Repeated error alert modal state (Issue #248)
  const [repeatedAlerts, setRepeatedAlerts] = useState<RepeatedErrorAlertItem[]>([]);
  const [showRepeatedAlert, setShowRepeatedAlert] = useState(false);
  const alertFetchedRef = useRef(false);

  const fetchRepeatedAlerts = useCallback(async () => {
    if (!token || !dbSessionId || alertFetchedRef.current) return;
    alertFetchedRef.current = true;
    try {
      // We need the studentId — derive it by calling the alert endpoint via
      // the token. The endpoint URL requires studentId, so we get it from the
      // JWT claims via the /users/me endpoint or pass studentId as a prop.
      // For now, use a workaround: decode the JWT student_id from the token.
      const payload = JSON.parse(atob(token.split('.')[1]));
      const studentId: number | undefined = payload?.user_id ?? payload?.sub;
      if (!studentId) return;
      const data = await getRepeatedErrorsAlert(token, Number(studentId));
      if (data.total > 0) {
        setRepeatedAlerts(data.alerts);
        setShowRepeatedAlert(true);
      }
    } catch {
      // Non-critical: silently ignore errors so the report page still works
    }
  }, [token, dbSessionId]);

  // Track lesson completion when a valid report is viewed.
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

  // Fetch repeated error alerts once when the report mounts (Issue #248)
  useEffect(() => {
    fetchRepeatedAlerts();
  }, [fetchRepeatedAlerts]);

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

  const { readingAttempt, comprehensionResult, vocabResult, dictationResult, fullReadingResult } = session;

  // Empty state: session exists but no learning data completed yet
  const hasNoData = !readingAttempt && !comprehensionResult && !vocabResult && !fullReadingResult;
  if (hasNoData) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center gap-6 py-24 text-center">
        <span className="text-6xl">📖</span>
        <h2 className="text-2xl font-bold text-gray-900">還沒有完成朗讀練習喔！</h2>
        <p className="text-gray-500">請先完成「逐段朗讀」或「全文朗讀」，才能查看學習報告。</p>
        <button
          onClick={onRetry}
          className="bg-accent hover:bg-accent-hover text-white px-6 py-2.5 rounded-full text-sm font-bold transition-all"
        >
          回到課文
        </button>
      </div>
    );
  }

  // Compute overall score
  const scores: number[] = [];
  if (readingAttempt) scores.push(readingAttempt.accuracy);
  if (comprehensionResult) scores.push(Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100));
  if (vocabResult) scores.push(vocabResult.totalChars > 0 ? Math.round((vocabResult.practicedChars.length / vocabResult.totalChars) * 100) : 100);
  if (dictationResult) scores.push(dictationResult.totalWords > 0 ? Math.round((dictationResult.correctCount / dictationResult.totalWords) * 100) : 0);
  if (fullReadingResult) scores.push(Math.round(fullReadingResult.matchRate * 100));
  const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  // Aggregate diff stats from lineBreakdown
  const lineBreakdown = readingAttempt?.lineBreakdown ?? [];
  const allLineDiffTokens = lineBreakdown.flatMap(l => l.diffTokens ?? []);
  const segmentStats = {
    correct: lineBreakdown.filter(l => l.matchRate >= 0.95).length,
    wrong: lineBreakdown.filter(l => l.matchRate < 0.95 && l.transcript).length,
    missing: lineBreakdown.filter(l => !l.transcript).length,
    total: lineBreakdown.length,
  };

  // Collect all wrong tokens for 環節四
  const wrongTokens: { char: string; expected: string }[] = [];
  const seen = new Set<string>();
  for (const t of allLineDiffTokens) {
    if (t.type === 'wrong' && t.expected) {
      const key = `${t.char}->${t.expected}`;
      if (!seen.has(key)) { seen.add(key); wrongTokens.push({ char: t.char, expected: t.expected }); }
    }
  }
  // Also include fullReading wrong tokens
  if (fullReadingResult?.diffTokens) {
    for (const t of fullReadingResult.diffTokens) {
      if (t.type === 'wrong' && t.expected) {
        const key = `${t.char}->${t.expected}`;
        if (!seen.has(key)) { seen.add(key); wrongTokens.push({ char: t.char, expected: t.expected }); }
      }
    }
  }

  // Also collect missing chars
  const missingChars: string[] = [];
  const seenMissing = new Set<string>();
  for (const t of allLineDiffTokens) {
    if (t.type === 'missing' && !seenMissing.has(t.char)) {
      seenMissing.add(t.char);
      missingChars.push(t.char);
    }
  }

  // Chart data for donut
  const accuracy = readingAttempt?.accuracy ?? 0;
  const scoreData = [
    { name: '準確度', value: accuracy, color: '#4A3FA3' },
    { name: '待改進', value: 100 - accuracy, color: '#f1f5f9' },
  ];

  const cpm = readingAttempt?.cpm ?? 0;
  const currentSegment = getCurrentSegment(cpm);
  const fullMatchPct = fullReadingResult ? Math.round(fullReadingResult.matchRate * 100) : null;

  // Practice suggestions
  const suggestions = readingAttempt ? generateSuggestions(wrongTokens, accuracy, cpm) : [];

  // --- Star rating calculation (Issue #222) ---
  // Best available reading accuracy: prefer full reading match rate, fall back to per-segment accuracy
  const bestReadingAccuracy =
    fullMatchPct !== null ? fullMatchPct : readingAttempt ? accuracy : null;

  // Comprehension score: use AI-evaluated score if available, else derive from dialogue result
  const comprehensionPct = comprehensionScores
    ? Math.round(comprehensionScores.comprehension_score)
    : comprehensionResult
    ? Math.round(
        (comprehensionResult.understoodCount /
          Math.max(comprehensionResult.requiredCount, 1)) *
          100,
      )
    : null;

  const starCount = calcStarRating({
    readingAccuracy: bestReadingAccuracy,
    comprehensionScore: comprehensionPct,
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
      {/* Repeated error alert modal (Issue #248) */}
      {showRepeatedAlert && repeatedAlerts.length > 0 && (
        <RepeatedErrorAlertModal
          alerts={repeatedAlerts}
          onDismiss={() => setShowRepeatedAlert(false)}
        />
      )}

      <CelebrationOverlay score={overallScore} />

      {/* ============ 星星評級 Star Rating (Issue #222) ============ */}
      <StarCelebration
        stars={starCount}
        readingAccuracy={bestReadingAccuracy}
        comprehensionScore={comprehensionPct}
      />

      {/* Header */}
      <div className="text-center">
        <div className="inline-block bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm font-bold mb-4">
          恭喜完成練習！
        </div>
        <h2 className="text-4xl font-bold mb-2">好棒！你今天又進步了。</h2>
        <p className="text-gray-500">讓我們看看這次學習的完整成果吧。</p>
        {story && (
          <p className="text-sm text-gray-400 mt-1">{story.title}</p>
        )}
        {overallScore !== null && (
          <div className="mt-4 inline-flex items-center gap-2 bg-accent/10 text-accent px-5 py-2 rounded-full">
            <span className="text-sm font-bold">綜合成績</span>
            <span className="text-2xl font-black">{overallScore}%</span>
          </div>
        )}
      </div>

      {/* ============ 環節一：朗讀結果總覽 ============ */}
      <Section number={1} title="朗讀結果總覽" defaultOpen={true} disabled={!readingAttempt && !fullReadingResult}>
        {readingAttempt || fullReadingResult ? (
          <div className="space-y-4">
            {/* 3 KPI Cards */}
            <div className="grid grid-cols-3 gap-4">
              {/* 準確度 */}
              <div className="text-center p-4 bg-slate-50 rounded-2xl">
                <div className="w-24 h-24 mx-auto relative">
                  <SafeResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={scoreData} innerRadius={30} outerRadius={42} paddingAngle={5} dataKey="value" startAngle={90} endAngle={-270}>
                        {scoreData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                    </PieChart>
                  </SafeResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-black text-accent">{accuracy}%</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 font-bold mt-1">逐段準確度</p>
              </div>

              {/* 語速 CPM */}
              <div className="text-center p-4 bg-slate-50 rounded-2xl flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-gray-900">{cpm}</span>
                <span className="text-xs text-gray-500 font-bold">正確字數/分鐘</span>
                <div className="flex gap-0.5 mt-2 w-full max-w-[120px]">
                  {speedSegments.map((seg, idx) => (
                    <div key={idx} className={`flex-1 h-1.5 rounded-sm ${idx === currentSegment ? seg.color : 'bg-gray-200'}`} />
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {speedSegments[currentSegment]?.label}
                </p>
              </div>

              {/* 全文匹配率 */}
              <div className="text-center p-4 bg-slate-50 rounded-2xl flex flex-col items-center justify-center">
                {fullMatchPct !== null ? (
                  <>
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 ${
                      fullMatchPct >= 80 ? 'border-emerald-500 text-emerald-700' : fullMatchPct >= 60 ? 'border-amber-500 text-amber-700' : 'border-red-400 text-red-600'
                    }`}>
                      <span className="text-lg font-black">{fullMatchPct}%</span>
                    </div>
                    <p className="text-xs text-gray-500 font-bold mt-1">全文匹配</p>
                    {fullReadingResult?.cpm != null && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{fullReadingResult.cpm} 正確字數/分鐘</p>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-black text-gray-300">--</span>
                    <p className="text-xs text-gray-400 font-bold mt-1">全文匹配</p>
                  </>
                )}
              </div>
            </div>

            {/* Speed feedback */}
            {readingAttempt && (
              <p className="text-sm text-gray-600 text-center">{getCpmFeedback(cpm).text}</p>
            )}
            {story?.readingBenchmark && (() => {
              const levels = parseReadingBenchmark(story.readingBenchmark.levels);
              const benchCpm = fullReadingResult?.cpm ?? cpm;
              const benchFeedback = getBenchmarkFeedback(benchCpm, levels);
              return benchFeedback ? (
                <p className="text-xs text-gray-400 text-center mt-1">課本標準：{benchFeedback}</p>
              ) : null;
            })()}

            {/* Goal achievement (Issue #84) — only shown when an assignment has goals */}
            {readingGoals && (
              <GoalAchievementCard
                effectiveCpm={readingGoals.effectiveCpm}
                effectiveAccuracy={readingGoals.effectiveAccuracy}
                actualCpm={fullReadingResult?.cpm ?? readingAttempt?.cpm}
                actualAccuracy={fullReadingResult ? Math.round(fullReadingResult.matchRate * 100) : readingAttempt?.accuracy}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">尚未完成朗讀練習</p>
        )}
      </Section>

      {/* ============ 環節二：錄音內容與智能分析 ============ */}
      <Section number={2} title="錄音內容與智能分析" defaultOpen={false} disabled={!readingAttempt && !fullReadingResult}>
        {(readingAttempt || fullReadingResult) ? (
          <div className="space-y-4">
            {/* Transcription text */}
            {((readingAttempt?.transcription ?? '').trim() || (fullReadingResult?.transcript ?? '').trim()) && (
              <div>
                <p className="text-xs text-gray-500 font-bold mb-2">語音轉文字</p>
                <div className="bg-slate-50 rounded-2xl p-4 text-sm text-gray-700 leading-relaxed">
                  {(readingAttempt?.transcription ?? '').trim() || (fullReadingResult?.transcript ?? '').trim()}
                </div>
              </div>
            )}

            {/* 4 category cards */}
            {lineBreakdown.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-bold mb-2">朗讀分析</p>
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-emerald-50 rounded-xl p-3 text-center">
                    <span className="text-2xl font-black text-emerald-600">{segmentStats.correct}</span>
                    <p className="text-xs text-emerald-600 font-bold mt-0.5">正確</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 text-center">
                    <span className="text-2xl font-black text-red-500">{segmentStats.wrong}</span>
                    <p className="text-xs text-red-500 font-bold mt-0.5">讀錯</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 text-center">
                    <span className="text-2xl font-black text-amber-600">{segmentStats.missing}</span>
                    <p className="text-xs text-amber-600 font-bold mt-0.5">遺漏</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <span className="text-2xl font-black text-blue-600">{segmentStats.total}</span>
                    <p className="text-xs text-blue-600 font-bold mt-0.5">總計</p>
                  </div>
                </div>
              </div>
            )}

            {/* Fallback: readingAttempt exists but no meaningful transcription or lineBreakdown data */}
            {!(readingAttempt?.transcription ?? '').trim() && !(fullReadingResult?.transcript ?? '').trim() && lineBreakdown.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">語音辨識資料不足，準確度過低時建議重新朗讀</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">尚未完成朗讀練習</p>
        )}
      </Section>

      {/* ============ 環節三：逐句分析對比 ============ */}
      <Section number={3} title="逐句分析對比" defaultOpen={false} disabled={lineBreakdown.length === 0}>
        {lineBreakdown.length > 0 ? (
          <div className="-mx-6 -mb-6">
            <p className="text-xs text-gray-500 px-6 mb-3">
              點擊每一段可展開查看逐字比對結果
            </p>
            <div className="divide-y divide-slate-100">
              {lineBreakdown.map((line, idx) => {
                const pct = Math.round(line.matchRate * 100);
                const isExpanded = expandedLine === idx;
                return (
                  <div key={idx}>
                    <button
                      onClick={() => setExpandedLine(isExpanded ? null : idx)}
                      className="w-full px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors text-left"
                    >
                      <span className="text-xs font-bold text-gray-400 w-8 shrink-0">#{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{line.transcript || '（未朗讀）'}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-sm font-bold ${pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                          {pct}%
                        </span>
                        <span className="text-xs text-gray-400">{line.cpm} 字/分</span>
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {isExpanded && line.diffTokens && (
                      <div className="px-6 pb-4 pt-1">
                        <DiffDisplay tokens={line.diffTokens} showLegend className="text-lg" />
                        <div className="flex gap-4 mt-3 text-xs text-gray-400">
                          <span>正確: {line.diffTokens.filter(t => t.type === 'correct').length} 字</span>
                          <span>讀錯: {line.diffTokens.filter(t => t.type === 'wrong').length} 字</span>
                          <span>漏讀: {line.diffTokens.filter(t => t.type === 'missing').length} 字</span>
                          <span>多讀: {line.diffTokens.filter(t => t.type === 'extra').length} 字</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Full reading diff (if available) */}
            {fullReadingResult?.diffTokens && fullReadingResult.diffTokens.length > 0 && (
              <div className="border-t border-slate-200 px-6 py-4">
                <p className="text-xs text-gray-500 font-bold mb-2">全文朗讀比對</p>
                <DiffDisplay tokens={fullReadingResult.diffTokens} showLegend className="text-lg" />
                {fullReadingResult.errorBreakdown && (
                  <div className="flex gap-4 mt-3 text-xs text-gray-400">
                    <span>正確: {fullReadingResult.errorBreakdown.correct} 字</span>
                    <span>讀錯: {fullReadingResult.errorBreakdown.wrong} 字</span>
                    <span>漏讀: {fullReadingResult.errorBreakdown.missing} 字</span>
                    <span>多讀: {fullReadingResult.errorBreakdown.extra} 字</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">尚無逐句比對資料</p>
        )}
      </Section>

      {/* ============ 環節四：錯字詞練習清單 ============ */}
      <Section number={4} title="錯字詞練習清單" defaultOpen={true} disabled={wrongTokens.length === 0 && missingChars.length === 0}>
        {wrongTokens.length > 0 || missingChars.length > 0 ? (
          <div className="space-y-4">
            {wrongTokens.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-bold mb-2">讀錯的字（共 {wrongTokens.length} 個）</p>
                <div>
                  {wrongTokens.map((t, idx) => (
                    <div key={idx} className="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-red-500 line-through text-lg">{t.char}</span>
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <span className="text-emerald-600 font-bold text-lg">{t.expected}</span>
                      </div>
                      <button
                        onClick={() => speakText(t.expected)}
                        className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors shrink-0"
                        title="聽發音"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {missingChars.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-bold mb-2">漏讀的字（共 {missingChars.length} 個）</p>
                <div className="flex flex-wrap gap-2">
                  {missingChars.slice(0, 20).map((ch, idx) => (
                    <button
                      key={idx}
                      onClick={() => speakText(ch)}
                      className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1"
                    >
                      {ch}
                      <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                      </svg>
                    </button>
                  ))}
                  {missingChars.length > 20 && (
                    <span className="text-xs text-gray-400 self-center">...還有 {missingChars.length - 20} 個</span>
                  )}
                </div>
              </div>
            )}

            {onGoToVocab && (
              <button
                onClick={onGoToVocab}
                className="w-full mt-2 flex items-center justify-center gap-2 py-3 bg-accent/10 hover:bg-accent/20 text-accent font-bold text-sm rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                去生字練習
              </button>
            )}
          </div>
        ) : (
          <div className="bg-green-50 rounded-2xl p-6 text-center">
            <p className="text-emerald-700 font-bold">
              {readingAttempt ? '恭喜！沒有讀錯的字詞！' : '尚無朗讀資料'}
            </p>
          </div>
        )}
      </Section>

      {/* ============ 環節五：練習建議 ============ */}
      <Section number={5} title="練習建議" defaultOpen={false} disabled={!readingAttempt}>
        {suggestions.length > 0 ? (
          <div className="space-y-3">
            {suggestions.map((s, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <span className="text-2xl shrink-0">{s.icon}</span>
                <div>
                  <p className="font-bold text-sm text-gray-900">{s.title}</p>
                  <p className="text-sm text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">完成朗讀練習後會產生建議</p>
        )}
      </Section>

      {/* ============ 環節六：課文理解力評估 (Issue #243) ============ */}
      <Section number={6} title="課文理解力評估" defaultOpen={true} disabled={!comprehensionScores && !comprehensionScoresLoading}>
        {comprehensionScores || comprehensionScoresLoading ? (
          <ComprehensionScoreCard
            comprehensionScore={comprehensionScores?.comprehension_score ?? 0}
            literalScore={comprehensionScores?.literal_score ?? 0}
            inferentialScore={comprehensionScores?.inferential_score ?? 0}
            evaluativeScore={comprehensionScores?.evaluative_score ?? 0}
            feedback={comprehensionScores?.feedback ?? null}
            loading={comprehensionScoresLoading}
          />
        ) : (
          <div className="p-6 bg-gray-50 rounded-2xl text-center">
            <p className="text-sm text-gray-400 font-bold">尚未完成課文理解對話</p>
            <p className="text-xs text-gray-300 mt-1">完成蘇格拉底式對話後，系統將評估你的三層次理解力</p>
          </div>
        )}
      </Section>

      {/* ============ 環節七：AI 詳細分析 (Issue #241, #415) ============ */}
      <Section number={7} title="AI 詳細分析" defaultOpen={false} disabled={!readingAttempt && !fullReadingResult}>
        {(readingAttempt || fullReadingResult) ? (
          <AIAnalysisSection
            storyTitle={story?.title ?? ''}
            accuracy={accuracy}
            cpm={fullReadingResult?.cpm ?? cpm}
            errorChars={wrongTokens.map(t => t.expected)}
            totalCharacters={
              fullReadingResult?.errorBreakdown
                ? (fullReadingResult.errorBreakdown.correct + fullReadingResult.errorBreakdown.wrong + fullReadingResult.errorBreakdown.missing + fullReadingResult.errorBreakdown.extra)
                : (readingAttempt?.lineBreakdown?.reduce((sum, l) => sum + (l.diffTokens?.length ?? 0), 0) ?? 0)
            }
            dbSessionId={dbSessionId}
            comprehensionScore={
              comprehensionScores
                ? comprehensionScores.comprehension_score
                : comprehensionResult
                ? Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100)
                : null
            }
            vocabPracticedCount={vocabResult?.practicedChars.length ?? null}
            vocabTotalCount={vocabResult?.totalChars ?? null}
            dictationCorrectCount={dictationResult?.correctCount ?? null}
            dictationTotalCount={dictationResult?.totalWords ?? null}
          />
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">完成朗讀練習後可使用 AI 分析</p>
        )}
      </Section>

      {/* ============ 補充資訊：生字練習 + 聽寫練習 + 課文理解 ============ */}
      {(vocabResult || dictationResult || comprehensionResult) && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">其他學習成果</h3>

          <div className="grid md:grid-cols-2 gap-4">
            {/* 生字練習 */}
            <div className={`rounded-2xl border p-5 ${vocabResult ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${vocabResult ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>3</span>
                <h4 className={`text-sm font-bold ${vocabResult ? 'text-gray-900' : 'text-gray-400'}`}>生字練習</h4>
              </div>
              {vocabResult ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div className="bg-accent h-2 rounded-full transition-all" style={{ width: vocabResult.totalChars > 0 ? `${Math.round((vocabResult.practicedChars.length / vocabResult.totalChars) * 100)}%` : '0%' }} />
                    </div>
                    <span className="text-xs font-bold text-gray-600">{vocabResult.practicedChars.length}/{vocabResult.totalChars}</span>
                  </div>
                  {vocabResult.practicedChars.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {vocabResult.practicedChars.map(ch => (
                        <span key={ch} className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold px-1.5 py-0.5 rounded">
                          {ch}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-2">未完成</p>
              )}
            </div>

            {/* 聽寫練習 */}
            {dictationResult && (
              <div className="rounded-2xl border p-5 bg-white border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-accent text-white">5</span>
                  <h4 className="text-sm font-bold text-gray-900">聽寫練習</h4>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all"
                        style={{ width: dictationResult.totalWords > 0 ? `${Math.round((dictationResult.correctCount / dictationResult.totalWords) * 100)}%` : '0%' }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-600">{dictationResult.correctCount}/{dictationResult.totalWords}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span className="text-emerald-600 font-medium">正確 {dictationResult.correctCount}</span>
                    {dictationResult.incorrectCount > 0 && (
                      <span className="text-red-500 font-medium">錯誤 {dictationResult.incorrectCount}</span>
                    )}
                    {dictationResult.skippedCount > 0 && (
                      <span className="text-gray-400">跳過 {dictationResult.skippedCount}</span>
                    )}
                  </div>
                  {dictationResult.results.some(r => !r.isCorrect && !r.skipped) && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">答錯的詞語</p>
                      {dictationResult.results
                        .filter(r => !r.isCorrect && !r.skipped)
                        .map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-gray-900">{r.word}</span>
                            <span className="text-gray-400">你答：</span>
                            <span className="text-red-500">{r.studentAnswer || '（空白）'}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 課文理解 */}
            <div className={`rounded-2xl border p-5 ${comprehensionResult ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${comprehensionResult ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>3</span>
                <h4 className={`text-sm font-bold ${comprehensionResult ? 'text-gray-900' : 'text-gray-400'}`}>課文理解</h4>
                {comprehensionResult?.isComplete && (
                  <span className="ml-auto bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">已完成</span>
                )}
              </div>
              {comprehensionResult ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100))}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-600">{comprehensionResult.understoodCount}/{comprehensionResult.requiredCount}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>對話 {comprehensionResult.conversationLength} 回</span>
                    <span>理解率 {Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100)}%</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-2">未完成</p>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* ============ 朗讀進步曲線 (#909) ============ */}
      {readingHistory.length >= 2 && (
        <Section number={8} title="朗讀進步曲線" defaultOpen={true}>
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
        </Section>
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
