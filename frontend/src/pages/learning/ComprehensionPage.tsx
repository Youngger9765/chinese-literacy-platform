import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ComprehensionChat from '../../components/reading-steps/ComprehensionChat';
import { useLearningContext } from '../../layouts/LearningLayout';

const ComprehensionPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    lastAttempt,
    handleFinishComprehension,
    emptyAttempt,
    dbSessionId,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: Record<string, unknown>, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'comprehension',
        stepData,
        currentStep: 'comprehension',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <ComprehensionChat
      story={selectedStory}
      attempt={lastAttempt ?? emptyAttempt}
      onFinish={handleFinishComprehension}
      onBack={() => navigate(`/learn/${storyId}/tutor`)}
      dbSessionId={dbSessionId ?? undefined}
      initialProgress={(stepProgressData.step_data?.comprehension as Record<string, unknown> | undefined) ?? undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default ComprehensionPage;
