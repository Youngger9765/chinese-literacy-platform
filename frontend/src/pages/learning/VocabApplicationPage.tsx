import React from 'react';
import VocabApplication from '../../components/reading-steps/VocabApplication';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabApplicationPage: React.FC = () => {
  const { selectedStory, handleFinishVocabApplication, syncProgress, flushProgress } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <VocabApplication
      story={selectedStory}
      onFinish={handleFinishVocabApplication}
      syncProgress={syncProgress}
      flushProgress={flushProgress}
    />
  );
};

export default VocabApplicationPage;
