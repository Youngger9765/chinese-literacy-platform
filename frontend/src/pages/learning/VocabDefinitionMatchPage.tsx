import React from 'react';
import VocabDefinitionMatch from '../../components/reading-steps/VocabDefinitionMatch';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabDefinitionMatchPage: React.FC = () => {
  const { selectedStory, handleFinishVocabDefinitionMatch } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <VocabDefinitionMatch
      story={selectedStory}
      onFinish={handleFinishVocabDefinitionMatch}
    />
  );
};

export default VocabDefinitionMatchPage;
