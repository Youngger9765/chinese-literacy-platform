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
  const { selectedStory, session, handleRetry, handleSessionComplete, dbSessionId, assignmentReadingGoals } = useLearningContext();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [xpResult, setXpResult] = useState<XPAwardResult | null>(null);
  const [showXpToast, setShowXpToast] = useState(false);

  // Three-level comprehension scores (Issue #243)
  const [comprehensionScores, setComprehensionScores] = useState<ComprehensionScoreResult | null>(null);
  const [comprehensionScoresLoading, setComprehensionScoresLoading] = useState(false);

  // Clear active session from localStorage when report is reached
  useEffect(() => {
    handleSessionComplete();
  }, [handleSessionComplete]);

  // Award XP once we have a confirmed backend session ID
  useEffect(() => {
    if (!dbSessionId || !token || !user?.id) return;

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
  }, [dbSessionId]);

  // Fetch 3-level comprehension scores when dialogue data is available (Issue #243)
  useEffect(() => {
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
  }, [dbSessionId]);

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
