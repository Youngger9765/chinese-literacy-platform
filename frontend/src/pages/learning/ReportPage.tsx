import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AssessmentReport from '../../components/reading-steps/AssessmentReport';
import XPAwardToast, { type XPAwardResult } from '../../components/gamification/XPAwardToast';
import { useLearningContext } from '../../layouts/LearningLayout';
import { useAuth } from '../../contexts/AuthContext';
import { reportSessionComplete } from '../../services/api';

const ReportPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, session, handleRetry, handleSessionComplete, dbSessionId, assignmentReadingGoals } = useLearningContext();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [xpResult, setXpResult] = useState<XPAwardResult | null>(null);
  const [showXpToast, setShowXpToast] = useState(false);

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

  const handleDismissToast = useCallback(() => {
    setShowXpToast(false);
    setXpResult(null);
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      <AssessmentReport
        session={session}
        story={selectedStory}
        onRetry={handleRetry}
        onGoToVocab={() => navigate(`/learn/${storyId}/vocab`)}
        dbSessionId={dbSessionId}
        token={token}
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
