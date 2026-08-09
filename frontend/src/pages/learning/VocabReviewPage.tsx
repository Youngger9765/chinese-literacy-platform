import React from 'react';
import VocabWordSearch from '../../components/reading-steps/VocabWordSearch';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabReviewPage: React.FC = () => {
  const { selectedStory, handleFinishVocabWordSearch } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <VocabWordSearch
      story={selectedStory}
      onFinish={handleFinishVocabWordSearch}
    />
  );
};

export default VocabReviewPage;
