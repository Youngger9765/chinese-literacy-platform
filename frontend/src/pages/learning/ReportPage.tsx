import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AssessmentReport from '../../components/reading-steps/AssessmentReport';
import XPAwardToast, { type XPAwardResult } from '../../components/gamification/XPAwardToast';
import { useLearningContext } from '../../layouts/LearningLayout';
import { useAuth } from '../../contexts/AuthContext';
import { reportSessionComplete } from '../../services/gamificationApi';
import {
  fetchDialogueHistory,
  getComprehensionScore,
  type ComprehensionScoreResult,
} from '../../services/learningApi';

const ReportPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    session,
    handleRetry,
    handleSessionComplete,
    dbSessionId,
    assignmentReadingGoals,
    isAssignmentReadyForSubmit,
    missingAssignmentSteps,
    firstIncompleteStepPath,
    hasActiveAssignment,
    saveStepProgressPatch,
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

  // Three-level comprehension scores (Issue #243)
  const [comprehensionScores, setComprehensionScores] = useState<ComprehensionScoreResult | null>(null);
  const [comprehensionScoresLoading, setComprehensionScoresLoading] = useState(false);

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

    reportSessionComplete(Number(user.id), dbSessionId, token, {
      readingAccuracy,
      comprehensionPassed,
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

  // Fetch 3-level comprehension scores when dialogue data is available (Issue #243)
  useEffect(() => {
    if (hasActiveAssignment && !isAssignmentReadyForSubmit) return;
    if (!dbSessionId || !token || !selectedStory || !session?.comprehensionResult) return;

    setComprehensionScoresLoading(true);
    fetchDialogueHistory(token, dbSessionId)
      .then((history) => {
        if (!history.turns || history.turns.length === 0) {
          setComprehensionScoresLoading(false);
          return;
        }
        // Filter to only ai/student turns (exclude 'feedback' turns used for internal bookkeeping)
        const dialogueTurns = history.turns
          .filter((t) => t.role === 'ai' || t.role === 'student')
          .map((t) => ({ role: t.role as 'ai' | 'student', text: t.text }));
        // Join paragraph array into a single string for the AI evaluation prompt
        const storyText = Array.isArray(selectedStory.content)
          ? selectedStory.content.join('\n')
          : (selectedStory.content as string);
        return getComprehensionScore(token, dbSessionId, {
          storyTitle: selectedStory.title,
          storyText,
          dialogueTurns,
        });
      })
      .then((scores) => {
        if (scores) setComprehensionScores(scores);
      })
      .catch((err: Error) => {
        // Non-critical — AssessmentReport falls back to basic comprehension result
        console.warn('Comprehension scoring failed (non-blocking):', err.message);
      })
      .finally(() => setComprehensionScoresLoading(false));
  // Run once per report page load — dbSessionId is the stable identifier
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSessionId, hasActiveAssignment, isAssignmentReadyForSubmit]);

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
              onClick={() => navigate(`/learn/${storyId}/${firstIncompleteStepPath}`)}
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

  // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing pattern, hook is after early return guard (#2289)
  const handleDismissToast = useCallback(() => {
    setShowXpToast(false);
    setXpResult(null);
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
      <AssessmentReport
        session={session}
        story={selectedStory}
        onRetry={handleRetry}
        onGoToVocab={() => navigate(`/learn/${storyId}/vocab`)}
        dbSessionId={dbSessionId}
        token={token}
        comprehensionScores={comprehensionScores}
        comprehensionScoresLoading={comprehensionScoresLoading}
        readingGoals={
          assignmentReadingGoals
            ? {
                effectiveCpm: assignmentReadingGoals.effective_cpm,
                effectiveAccuracy: assignmentReadingGoals.effective_accuracy,
                difficultyLabel: assignmentReadingGoals.difficulty_label,
              }
            : undefined
        }
      />

      {showXpToast && xpResult && (
        <XPAwardToast result={xpResult} onDismiss={handleDismissToast} />
      )}
    </div>
  );
};

export default ReportPage;
