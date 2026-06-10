import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DictationPractice from '../../components/reading-steps/DictationPractice';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { DictationStepData } from '../../types/stepProgress';

const DictationPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishDictation,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: DictationStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'dictation',
        stepData,
        currentStep: 'dictation',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <DictationPractice
      story={selectedStory}
      onFinish={handleFinishDictation}
      onBack={() => navigate(`/learn/${storyId}/vocab`)}
      initialProgress={stepProgressData.step_data?.dictation as DictationStepData | undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default DictationPage;
