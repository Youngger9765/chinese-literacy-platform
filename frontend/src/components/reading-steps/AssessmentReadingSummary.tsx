/**
 * AssessmentReadingSummary — Section 1 of AssessmentReport (#1845).
 *
 * Renders 朗讀結果總覽 (環節一).
 * Teacher view (hideScores=false): shows 3 KPI cards with numeric scores.
 * Student view (hideScores=true): shows encouragement copy only.
 */

import React, { useRef, useState, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { CPM_VERY_FAST, CPM_FAST, CPM_MEDIUM, CPM_SLOW } from '../../utils/personaConfig';
import { parseReadingBenchmark, getBenchmarkFeedback } from '../../utils/fluencyAnalyzer';
import GoalAchievementCard from '../ui/GoalAchievementCard';
import { encourageAccuracy, encourageReadingDone } from '../../utils/encouragement';
import type { Story } from '../../types';
import type { FullReadingResult } from '../../types';
import type { ReadingAttempt } from '../../types';

/** Duplicate-free within-file — avoids importing from AssessmentReport */
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
        <ResponsiveContainer width={width as number | `${number}%`} height={height as number | `${number}%`}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      )}
    </div>
  );
};

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

export interface AssessmentReadingSummaryProps {
  readingAttempt: ReadingAttempt | null;
  fullReadingResult: FullReadingResult | null;
  hideScores: boolean;
  story?: Story | null;
  readingGoals?: { effectiveCpm: number; effectiveAccuracy: number; difficultyLabel?: string | null } | null;
}

const AssessmentReadingSummary: React.FC<AssessmentReadingSummaryProps> = ({
  readingAttempt,
  fullReadingResult,
  hideScores,
  story,
  readingGoals,
}) => {
  const accuracy = readingAttempt?.accuracy ?? 0;
  const cpm = readingAttempt?.cpm ?? 0;
  const currentSegment = getCurrentSegment(cpm);
  const fullMatchPct = fullReadingResult ? Math.round(fullReadingResult.matchRate * 100) : null;

  const scoreData = [
    { name: '準確度', value: accuracy, color: '#4A3FA3' },
    { name: '待改進', value: 100 - accuracy, color: '#f1f5f9' },
  ];

  if (!readingAttempt && !fullReadingResult) {
    return <p className="text-sm text-gray-400 text-center py-4">尚未完成朗讀練習</p>;
  }

  return (
    <div className="space-y-4">
      {/* KPI Cards — teacher view shows 3 cards with numbers; student view shows encouragement */}
      {hideScores ? (
        <div className="bg-accent/5 rounded-2xl p-6 text-center space-y-2">
          <p className="text-lg font-bold text-accent">{encourageAccuracy(accuracy)}</p>
          {readingAttempt && (
            <p className="text-sm text-gray-600">{encourageReadingDone()}</p>
          )}
        </div>
      ) : (
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
      )}

      {/* Speed feedback — text-based, shown in teacher view only */}
      {readingAttempt && !hideScores && (
        <p className="text-sm text-gray-600 text-center">{getCpmFeedback(cpm).text}</p>
      )}
      {!hideScores && story?.readingBenchmark && (() => {
        const levels = parseReadingBenchmark(story.readingBenchmark.levels);
        const benchCpm = fullReadingResult?.cpm ?? cpm;
        const benchFeedback = getBenchmarkFeedback(benchCpm, levels);
        return benchFeedback ? (
          <p className="text-xs text-gray-400 text-center mt-1">課本標準：{benchFeedback}</p>
        ) : null;
      })()}

      {/* Goal achievement (Issue #84) — hidden for students (numbers-based) */}
      {readingGoals && !hideScores && (
        <GoalAchievementCard
          effectiveCpm={readingGoals.effectiveCpm}
          effectiveAccuracy={readingGoals.effectiveAccuracy}
          actualCpm={fullReadingResult?.cpm ?? readingAttempt?.cpm}
          actualAccuracy={fullReadingResult ? Math.round(fullReadingResult.matchRate * 100) : readingAttempt?.accuracy}
        />
      )}
    </div>
  );
};

export default AssessmentReadingSummary;
