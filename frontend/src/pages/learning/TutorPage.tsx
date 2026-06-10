import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LiveTutor from '../../components/reading-steps/LiveTutor';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { TutorStepData } from '../../types/stepProgress';

const TutorPage: React.FC = () => {
  const {
    selectedStory,
    rightPanelWidth,
    setRightPanelWidth,
    handleFinishReading,
    completedParagraphsSet,
    handleParagraphComplete,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: TutorStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'tutor',
        stepData,
        currentStep: 'tutor',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <LiveTutor
      story={selectedStory}
      rightPanelWidth={rightPanelWidth}
      onPanelWidthChange={setRightPanelWidth}
      onFinish={handleFinishReading}
      onCancel={() => navigate('/library')}
      onParagraphComplete={handleParagraphComplete}
      initialCompletedParagraphs={completedParagraphsSet}
      initialProgress={stepProgressData.step_data?.tutor as TutorStepData | undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default TutorPage;
