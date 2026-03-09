import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AssessmentReport from '../../components/reading-steps/AssessmentReport';
import XPAwardToast from '../../components/gamification/XPAwardToast';
import { useLearningContext } from '../../layouts/LearningLayout';
import { useAuth } from '../../contexts/AuthContext';
import { awardSessionCompletion, type SessionCompletionResult } from '../../services/gamificationApi';

const ReportPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, session, handleRetry, handleSessionComplete, dbSessionId } = useLearningContext();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [xpResult, setXpResult] = useState<SessionCompletionResult | null>(null);
  const [showXpToast, setShowXpToast] = useState(false);

  // Clear active session and award XP when report is reached
  useEffect(() => {
    handleSessionComplete();
  }, [handleSessionComplete]);

  // Award XP once we have a dbSessionId (set after backend session creation)
  useEffect(() => {
    if (!dbSessionId || !token || !user?.id) return;

    const readingAccuracy = session?.readingAttempt?.accuracy ?? null;
    const comprehensionPct = session?.comprehensionResult
      ? Math.round(
          (session.comprehensionResult.understoodCount /
            Math.max(session.comprehensionResult.requiredCount, 1)) *
            100
        )
      : null;
    const comprehensionPassed = comprehensionPct !== null && comprehensionPct >= 60;

    awardSessionCompletion(parseInt(user.id, 10), dbSessionId, readingAccuracy, comprehensionPassed, token)
      .then((result) => {
        if (result.xp_earned > 0) {
          setXpResult(result);
          setShowXpToast(true);
        }
      })
      .catch((err: Error) => {
        // Non-critical — don't show error to student
        console.warn('XP award failed (non-blocking):', err.message);
      });
    // Only run once per report page load
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
      />

      {showXpToast && xpResult && (
        <XPAwardToast result={xpResult} onDismiss={handleDismissToast} />
      )}
    </div>
  );
};

export default ReportPage;
