import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import FullReading from '../../components/reading-steps/FullReading';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { FullReadingStepData } from '../../types/stepProgress';

const FullReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishFullReading,
    session,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: FullReadingStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'full-reading',
        stepData,
        currentStep: 'full-reading',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <FullReading
      story={selectedStory}
      onFinish={handleFinishFullReading}
      onBack={() => navigate(`/learn/${storyId}/tutor`)}
      initialResult={session?.fullReadingResult ?? null}
      initialProgress={stepProgressData.step_data?.['full-reading'] as FullReadingStepData | undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default FullReadingPage;
