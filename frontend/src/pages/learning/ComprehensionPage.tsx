import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ComprehensionChat from '../../components/reading-steps/ComprehensionChat';
import { useLearningContext } from '../../layouts/LearningLayout';

const ComprehensionPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    lastAttempt,
    rightPanelWidth,
    setRightPanelWidth,
    handleFinishComprehension,
    emptyAttempt,
    dbSessionId,
  } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <ComprehensionChat
      story={selectedStory}
      attempt={lastAttempt ?? emptyAttempt}
      rightPanelWidth={rightPanelWidth}
      onPanelWidthChange={setRightPanelWidth}
      onFinish={handleFinishComprehension}
      onBack={() => navigate(`/learn/${storyId}/tutor`)}
      dbSessionId={dbSessionId ?? undefined}
    />
  );
};

export default ComprehensionPage;
