import React from 'react';
import KnowledgeStation from '../../components/reading-steps/KnowledgeStation';
import { useLearningContext } from '../../layouts/LearningLayout';

const KnowledgeStationPage: React.FC = () => {
  const { selectedStory, handleFinishKnowledgeStation } = useLearningContext();

  if (!selectedStory) return null;

  // #1683: removed missingSteps prop — the "N 個關卡沒有完成" reminder is no longer
  // shown per Young 5/19. missingAssignmentSteps is still consumed by other consumers.
  return (
    <KnowledgeStation
      story={selectedStory}
      onFinish={handleFinishKnowledgeStation}
    />
  );
};

export default KnowledgeStationPage;
