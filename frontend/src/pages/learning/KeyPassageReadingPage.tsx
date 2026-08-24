import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import KeyPassageReading from '../../components/reading-steps/KeyPassageReading';
import { useCurrentStepId, useCurrentSectionSlug } from '../../hooks/useCurrentStepId';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { KeyPassageReadingStepData } from '../../types/stepProgress';

/** Canonical step id this page is registered under in STEP_REGISTRY. */
const CANONICAL_STEP_ID = 'key-passage-reading';

const KeyPassageReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishKeyPassageReading,
    session,
    stepProgressData,
    saveStepProgressPatch,
    dbSessionId,
  } = useLearningContext();
  // QR 要印這一節自己的代號（#2916）—— 頁面在 Router 裡，葉元件不是
  const sectionSlug = useCurrentSectionSlug();
  const navigate = useNavigate();

  // #2588: read/write progress under the step id this page is actually mounted at
  // (falls back to CANONICAL_STEP_ID), so the progress key can never drift away
  // from the route / transition map and silently break assignment completion.
  const stepId = useCurrentStepId(CANONICAL_STEP_ID);

  const handleProgressChange = useCallback(
    (stepData: KeyPassageReadingStepData, immediate = false) => {
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
    <KeyPassageReading
      sectionSlug={sectionSlug}
      story={selectedStory}
      onFinish={handleFinishKeyPassageReading}
      onBack={() => navigate(`/learn/${storyId}/paragraph-reading`)}
      initialResult={session?.fullReadingResult ?? null}
      initialProgress={stepProgressData.step_data?.[stepId] as KeyPassageReadingStepData | undefined}
      onProgressChange={handleProgressChange}
      dbSessionId={dbSessionId}
    />
  );
};

export default KeyPassageReadingPage;
