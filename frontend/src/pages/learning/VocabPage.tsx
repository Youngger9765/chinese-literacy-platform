import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import VocabPractice from '../../components/reading-steps/VocabPractice';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { VocabStepData } from '../../types/stepProgress';

const VocabPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    lastAttempt,
    handleFinishVocab,
    emptyAttempt,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: VocabStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'vocab',
        stepData,
        currentStep: 'vocab',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <VocabPractice
      story={selectedStory}
      attempt={lastAttempt ?? emptyAttempt}
      onFinish={handleFinishVocab}
      onBack={() => navigate(`/learn/${storyId}/comprehension`)}
      initialProgress={stepProgressData.step_data?.vocab as VocabStepData | undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default VocabPage;
