import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AssessmentReport from '../../components/reading-steps/AssessmentReport';
import { useLearningContext } from '../../layouts/LearningLayout';

const ReportPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, session, handleRetry } = useLearningContext();
  const navigate = useNavigate();

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      <AssessmentReport
        session={session}
        story={selectedStory}
        onRetry={handleRetry}
        onGoToVocab={() => navigate(`/learn/${storyId}/vocab`)}
      />
    </div>
  );
};

export default ReportPage;
