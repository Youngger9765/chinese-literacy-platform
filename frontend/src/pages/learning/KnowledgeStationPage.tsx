import React from 'react';
import KnowledgeStation from '../../components/reading-steps/KnowledgeStation';
import { useLearningContext } from '../../layouts/LearningLayout';

const KnowledgeStationPage: React.FC = () => {
  const { selectedStory, handleFinishKnowledgeStation } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <KnowledgeStation
      story={selectedStory}
      onFinish={handleFinishKnowledgeStation}
    />
  );
};

export default KnowledgeStationPage;
