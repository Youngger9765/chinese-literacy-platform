import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import FullReading from '../../components/reading-steps/FullReading';
import { useCurrentStepId } from '../../hooks/useCurrentStepId';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { FullReadingStepData } from '../../types/stepProgress';

/** Canonical step id this page is registered under in STEP_REGISTRY. */
const CANONICAL_STEP_ID = 'full-reading';

const FullReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishFullReading,
    session,
    stepProgressData,
    saveStepProgressPatch,
    dbSessionId,
  } = useLearningContext();
  const navigate = useNavigate();

  // #2588: read/write progress under the step id this page is actually mounted at
  // (falls back to CANONICAL_STEP_ID), so the progress key can never drift away
  // from the route / transition map and silently break assignment completion.
  const stepId = useCurrentStepId(CANONICAL_STEP_ID);

  const handleProgressChange = useCallback(
    (stepData: FullReadingStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId,
        stepData,
        currentStep: stepId,
        immediate,
      });
    },
    [saveStepProgressPatch, stepId],
  );

  if (!selectedStory) return null;

  return (
    <FullReading
      story={selectedStory}
      onFinish={handleFinishFullReading}
      onBack={() => navigate(`/learn/${storyId}/tutor`)}
      initialResult={session?.fullReadingResult ?? null}
      initialProgress={stepProgressData.step_data?.[stepId] as FullReadingStepData | undefined}
      onProgressChange={handleProgressChange}
      dbSessionId={dbSessionId}
    />
  );
};

export default FullReadingPage;
