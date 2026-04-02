import React, { useCallback } from 'react';
import VocabDefinitionMatch from '../../components/reading-steps/VocabDefinitionMatch';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabDefinitionMatchPage: React.FC = () => {
  const {
    selectedStory,
    handleFinishVocabDefinitionMatch,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();

  const handleProgressChange = useCallback(
    (stepData: Record<string, unknown>, immediate = false) => {
      const isCompleted = stepData.completed === true;
      saveStepProgressPatch({
        stepId: 'vocab-definition',
        stepData,
        currentStep: 'vocab-definition',
        markCompleted: isCompleted,
        immediate: immediate || isCompleted,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <VocabDefinitionMatch
      story={selectedStory}
      onFinish={handleFinishVocabDefinitionMatch}
      initialProgress={(stepProgressData.step_data?.['vocab-definition'] as Record<string, unknown> | undefined) ?? undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default VocabDefinitionMatchPage;
