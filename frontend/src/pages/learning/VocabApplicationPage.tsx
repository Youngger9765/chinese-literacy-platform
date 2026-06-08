import React from 'react';
import VocabApplication from '../../components/reading-steps/VocabApplication';
import OmoPaperResultBanner from '../../components/reading-steps/OmoPaperResultBanner';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabApplicationPage: React.FC = () => {
  const { selectedStory, handleFinishVocabApplication, saveStepProgressPatch } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <>
      <OmoPaperResultBanner stepId="vocab-application" />
      <VocabApplication
        story={selectedStory}
        onFinish={handleFinishVocabApplication}
        saveStepProgressPatch={saveStepProgressPatch}
      />
    </>
  );
};

export default VocabApplicationPage;
