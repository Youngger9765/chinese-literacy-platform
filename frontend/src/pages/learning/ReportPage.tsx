import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { stepPath } from '../../config/stepPath';
import { useNavigate, useParams } from 'react-router-dom';
import XPAwardToast, { type XPAwardResult } from '../../components/gamification/XPAwardToast';
import { useLearningContext } from '../../layouts/LearningLayout';
import { useAuth } from '../../contexts/AuthContext';
import { reportSessionComplete } from '../../services/gamificationApi';
import { resolveActiveSteps } from '../../config/stepConfig';
import StepReportCards from '../../components/report/StepReportCards';
import { useReportProgress } from '../../components/report/useReportProgress';
import { buildStepReportCards, marksFromAnnotations } from '../../components/report/reportCardsModel';

/**
 * 報告頁（#3399）：每一關一張卡片，完成打綠勾，點開看分數與作答。
 *
 * 以前這裡是 AssessmentReport —— 朗讀六環節診斷、AI 理解度評分、折線圖。
 * Mentor 回饋那些對學生太複雜，學生只要看到「我做完了哪些、做得怎樣」。
 * AssessmentReport 仍在老師端與歷史紀錄頁使用，這裡只換學生流程的報告頁。
 * 拿掉的 AI 理解度評分（getComprehensionScore）是一次 LLM 呼叫，現在不再打。
 */

const ReportPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    session,
    handleSessionComplete,
    dbSessionId,
    isAssignmentReadyForSubmit,
    missingAssignmentSteps,
    firstIncompleteStepPath,
    hasActiveAssignment,
    saveStepProgressPatch,
    stepProgressData,
  } = useLearningContext();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  // Issue #1549 — mark report as viewed in step_progress on mount, so the
  // teacher dashboard can confirm the student reached the final report.
  // Runs once per (story, dbSessionId) pair.
  const reportMarkedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!selectedStory?.id) return;
    const key = `${selectedStory.id}-${dbSessionId ?? 'no-session'}`;
    if (reportMarkedRef.current === key) return;
    reportMarkedRef.current = key;
    saveStepProgressPatch({
      stepId: 'report',
      stepData: {
        viewed_at: new Date().toISOString(),
        exit_ticket_id: null,
      },
      markCompleted: true,
      immediate: true,
    });
  }, [selectedStory?.id, dbSessionId, saveStepProgressPatch]);

  const [xpResult, setXpResult] = useState<XPAwardResult | null>(null);
  const [showXpToast, setShowXpToast] = useState(false);

  // Clear active session from localStorage when report is reached
  useEffect(() => {
    if (hasActiveAssignment && !isAssignmentReadyForSubmit) return;
    handleSessionComplete();
  }, [handleSessionComplete, hasActiveAssignment, isAssignmentReadyForSubmit]);

  // Award XP once we have a confirmed backend session ID
  useEffect(() => {
    if (hasActiveAssignment && !isAssignmentReadyForSubmit) return;
    if (!dbSessionId || !token || !user?.id) return;
    // Skip XP award when student hasn't completed any learning steps yet
    const hasLearningData = !!(
      session?.readingAttempt ||
      session?.fullReadingResult ||
      session?.comprehensionResult ||
      session?.vocabResult
    );
    if (!hasLearningData) return;

    const readingAccuracy = session?.readingAttempt?.accuracy;
    const comprehensionPct = session?.comprehensionResult
      ? Math.round(
          (session.comprehensionResult.understoodCount /
            Math.max(session.comprehensionResult.requiredCount, 1)) *
            100
        )
      : undefined;
    const comprehensionPassed = comprehensionPct !== undefined && comprehensionPct >= 60;

    // comprehensionPct 這裡本來就算好了，原本卻只把 `>= 60` 的布林送上去 ——
    // 於是沒達標的學生在後端整段 `if scores` 不成立，**完全沒有分數**（#2904）。
    // 真實百分比一起送，後端有值就用它；舊 build 沒送時才退回 passed。
    reportSessionComplete(Number(user.id), dbSessionId, token, {
      readingAccuracy,
      comprehensionPassed,
      comprehensionScore: comprehensionPct,
    })
      .then((result) => {
        if (result.xp_earned > 0) {
          setXpResult({
            xp_earned: result.xp_earned,
            new_total_xp: result.new_total_xp,
            level_info: result.level_info,
            streak: result.streak,
            badges_unlocked: result.badges_unlocked,
          });
          setShowXpToast(true);
        }
      })
      .catch((err: Error) => {
        // Non-critical — don't block student view
        console.warn('XP award failed (non-blocking):', err.message);
      });
    // Run once per report page load — dbSessionId is the stable identifier
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSessionId, hasActiveAssignment, isAssignmentReadyForSubmit]);

  // 進度與記號都直接讀 DB（含重新整理後的 carry-forward，理由見 hook）。
  const report = useReportProgress(dbSessionId, token, storyId, stepProgressData);

  const cards = useMemo(
    () =>
      buildStepReportCards(
        resolveActiveSteps(selectedStory?.stepSequence),
        report.progress?.steps_completed ?? session?.completedSteps,
        report.progress?.step_data,
        report.annotations ? marksFromAnnotations(report.annotations, selectedStory?.content) : null,
      ),
    [selectedStory?.stepSequence, selectedStory?.content, report.progress, report.annotations, session?.completedSteps],
  );

  const handleDismissToast = useCallback(() => {
    setShowXpToast(false);
    setXpResult(null);
  }, []);

  if (hasActiveAssignment && !isAssignmentReadyForSubmit) {
    return (
      <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-amber-900 mb-2">作業尚未完成</h2>
          <p className="text-sm text-amber-800 mb-4">
            完成所有必做關卡後，才可查看報告並標記為已繳交。
          </p>
          <div className="bg-white border border-amber-100 rounded-xl p-4 mb-5">
            <p className="text-xs font-semibold text-amber-700 mb-2">尚未完成關卡</p>
            <div className="flex flex-wrap gap-2">
              {missingAssignmentSteps.map((s) => (
                <span key={s.id} className="inline-flex px-2.5 py-1 rounded-full text-xs bg-amber-100 text-amber-800">
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(stepPath(storyId!, firstIncompleteStepPath))}
              className="px-6 py-2.5 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-bold"
            >
              繼續未完成關卡
            </button>
            <button
              type="button"
              onClick={() => navigate('/assignments')}
              className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50"
            >
              返回班級作業
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:p-8 max-w-4xl mx-auto w-full">
      {report.loading && dbSessionId ? (
        <p className="py-16 text-center text-on-surface-variant" role="status">載入學習成果…</p>
      ) : (
        <StepReportCards
          storyTitle={selectedStory?.title}
          cards={cards}
          onGoToStep={(stepId) => navigate(stepPath(storyId!, stepId))}
        />
      )}

      {showXpToast && xpResult && (
        <XPAwardToast result={xpResult} onDismiss={handleDismissToast} />
      )}
    </div>
  );
};

export default ReportPage;
