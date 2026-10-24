/**
 * SessionHistoryReportPage — shows a historical session in two tabs:
 *   1. 學習報告 — 關卡完成卡片（StepReportCards，#3749；在學習流程裡的
 *      ReportPage.tsx 用的是同一套元件與邏輯 — reportCardsModel.ts + useReportProgress）
 *   2. 作答紀錄 — per-step answer records (reading errors, dialogue Q&A, vocab, full-reading diff)
 *
 * Route: /sessions/:sessionId/report
 * Issue #580 + #416
 *
 * Refactored (Issue #1958): split into focused sub-components under ./session-history/.
 * Named exports here keep existing import paths working for tests and consumers.
 *
 * #3749：「學習報告」分頁原本是 AssessmentReport（朗讀六環節診斷、AI 理解度評分、
 * 折線圖……）。#3399 把學習流程內的報告步驟換成「關卡完成卡片」之後，刻意把這個
 * 歷史紀錄頁留在舊格式 —— 但學生從「學習歷史」點進來看到的，應該跟剛完成學習時
 * 看到的是同一種格式，不然會覺得「怎麼還是舊的」。「作答紀錄」分頁不動：那是
 * 逐題明細（對話紀錄、朗讀 diff），跟卡片頁的「完成與否 + 分數摘要」是不同用途。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStory } from '../../services/api';
import {
  fetchSessionReport,
  type SessionDetailResponse,
  type ComprehensionScoreResult,
} from '../../services/learningApi';
import type { Story } from '../../types';
import PageLoader from '../../components/ui/PageLoader';
import { resolveActiveSteps } from '../../config/stepConfig';
import { stepPath } from '../../config/stepPath';
import StepReportCards from '../../components/report/StepReportCards';
import { useReportProgress } from '../../components/report/useReportProgress';
import { buildStepReportCards, marksFromAnnotations } from '../../components/report/reportCardsModel';

import { buildComprehensionScores } from './session-history/helpers';
import { StepRecordsView as _StepRecordsView } from './session-history/StepRecordsView';

// ---------------------------------------------------------------------------
// Re-export sub-components so tests / consumers can import from this file
// ---------------------------------------------------------------------------
export { ReportSectionAccordion } from './session-history/ReportSectionAccordion';
export { ReadingRecord } from './session-history/ReadingRecord';
export { KeyPassageReadingRecord } from './session-history/KeyPassageReadingRecord';
export { VocabRecord } from './session-history/VocabRecord';
export { ComprehensionRecord } from './session-history/ComprehensionRecord';
export { StepRecordsView } from './session-history/StepRecordsView';

// ---------------------------------------------------------------------------
// Page component (orchestrator + data fetching only)
// ---------------------------------------------------------------------------

type PageTab = 'report' | 'steps';

const SessionHistoryReportPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [comprehensionScores, setComprehensionScores] =
    useState<ComprehensionScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<PageTab>('report');

  const dbSessionId = sessionId ? Number(sessionId) : null;

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

  // #3749 — 關卡卡片的進度與記號直接讀 DB（跟學習流程內的 ReportPage.tsx 同一套）。
  // 沒有可以退回用的本機 state（這是歷史紀錄頁，不是進行中的 session），
  // fallback 傳 null：真的讀失敗時卡片會顯示「尚未完成」而不是編造的資料。
  // carryForwardMarks 傳 false：這裡看的是清單裡點進來的某一筆指定紀錄，同一課
  // 其他 session 可能是更早或更晚、不相干的另一次嘗試，不該把別次的記號顯示成
  // 這一筆的（carry-forward 是為了 ReportPage.tsx 重新整理時的同一次嘗試設計的，
  // 見 useReportProgress.ts 檔頭說明）。
  const report = useReportProgress(dbSessionId, token, detail?.story_slug ?? undefined, null, false);

  const cards = useMemo(
    () =>
      buildStepReportCards(
        resolveActiveSteps(story?.stepSequence),
        report.progress?.steps_completed,
        report.progress?.step_data,
        report.annotations ? marksFromAnnotations(report.annotations, story?.content) : null,
      ),
    [story, report.progress, report.annotations],
  );

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
  const storyId = story?.id;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 space-y-4">

        {/* Teacher review banner */}
        {teacherReviewedAt && (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              老師已查看（{new Date(teacherReviewedAt).toLocaleDateString('zh-TW')}）
            </div>
            {teacherComment && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-purple-700 mb-1">老師評語</p>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {teacherComment}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab nav */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px" aria-label="檢視模式">
            {(
              [
                { key: 'report', label: '學習報告' },
                { key: 'steps', label: '作答紀錄' },
              ] as { key: PageTab; label: string }[]
            ).map((tab) => (
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
          report.loading && dbSessionId ? (
            <p className="py-16 text-center text-gray-500" role="status">載入學習成果…</p>
          ) : (
            <StepReportCards
              storyTitle={story?.title}
              cards={cards}
              onGoToStep={storyId ? (stepId) => navigate(stepPath(storyId, stepId)) : undefined}
            />
          )
        ) : (
          detail && (
            <_StepRecordsView
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
