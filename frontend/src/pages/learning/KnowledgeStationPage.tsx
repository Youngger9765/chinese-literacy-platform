import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import KnowledgeStation from '../../components/reading-steps/KnowledgeStation';
import { useLearningContext } from '../../layouts/LearningLayout';

const KnowledgeStationPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, handleFinishKnowledgeStation, missingAssignmentSteps } = useLearningContext();
  const navigate = useNavigate();

  // missingAssignmentSteps excludes 'knowledge-station' itself and 'report'
  // Filter out knowledge-station so we don't tell them to jump to where they already are
  const missingSteps = missingAssignmentSteps.filter(
    (s) => s.id !== 'knowledge-station',
  );

  const handleNavigateToStep = useCallback(
    (stepId: string) => {
      if (storyId) {
        navigate(`/learn/${storyId}/${stepId}`);
      }
    },
    [storyId, navigate],
  );

  if (!selectedStory) return null;

  return (
    <KnowledgeStation
      story={selectedStory}
      onFinish={handleFinishKnowledgeStation}
      missingSteps={missingSteps}
      onNavigateToStep={handleNavigateToStep}
    />
  );
};

export default KnowledgeStationPage;
