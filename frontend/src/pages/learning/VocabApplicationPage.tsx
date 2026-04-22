import React from 'react';
import VocabApplication from '../../components/reading-steps/VocabApplication';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabApplicationPage: React.FC = () => {
  const { selectedStory, handleFinishVocabApplication, saveStepProgressPatch } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <VocabApplication
      story={selectedStory}
      onFinish={handleFinishVocabApplication}
      saveStepProgressPatch={saveStepProgressPatch}
    />
  );
};

export default VocabApplicationPage;
