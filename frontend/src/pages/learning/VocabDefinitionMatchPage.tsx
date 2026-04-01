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
      saveStepProgressPatch({
        stepId: 'vocab-definition',
        stepData,
        currentStep: 'vocab-definition',
        immediate,
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
