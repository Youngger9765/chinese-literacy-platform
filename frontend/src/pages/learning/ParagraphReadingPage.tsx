import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ParagraphReading from '../../components/reading-steps/ParagraphReading';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { TutorStepData } from '../../types/stepProgress';

const ParagraphReadingPage: React.FC = () => {
  const {
    selectedStory,
    rightPanelWidth,
    setRightPanelWidth,
    handleFinishReading,
    completedParagraphsSet,
    handleParagraphComplete,
    resetTutorStep,
    stepProgressData,
    saveStepProgressPatch,
    dbSessionId,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: TutorStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'paragraph-reading',
        stepData,
        currentStep: 'paragraph-reading',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <ParagraphReading
      story={selectedStory}
      rightPanelWidth={rightPanelWidth}
      onPanelWidthChange={setRightPanelWidth}
      onFinish={handleFinishReading}
      onCancel={() => navigate('/library')}
      onParagraphComplete={handleParagraphComplete}
      initialCompletedParagraphs={completedParagraphsSet}
      initialProgress={stepProgressData.step_data?.tutor as TutorStepData | undefined}
      onProgressChange={handleProgressChange}
      onResetTutor={resetTutorStep}
      dbSessionId={dbSessionId}
    />
  );
};

export default ParagraphReadingPage;
