import React from 'react';
import KnowledgeStation from '../../components/reading-steps/KnowledgeStation';
import { useLearningContext } from '../../layouts/LearningLayout';

const KnowledgeStationPage: React.FC = () => {
  const { selectedStory, handleFinishKnowledgeStation, missingAssignmentSteps } = useLearningContext();

  if (!selectedStory) return null;

  // Exclude 'knowledge-station' and 'report' from the missing list shown in the reminder
  // (student is already on knowledge-station; report is the destination)
  const missingStepsForReminder = missingAssignmentSteps.filter(
    (s) => s.id !== 'knowledge-station' && s.id !== 'report',
  );

  return (
    <KnowledgeStation
      story={selectedStory}
      onFinish={handleFinishKnowledgeStation}
      missingSteps={missingStepsForReminder}
    />
  );
};

export default KnowledgeStationPage;
