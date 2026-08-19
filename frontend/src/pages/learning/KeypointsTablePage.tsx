/**
 * KeypointsTablePage — Step: 文章重點表 (story-structure, dbStep 15)
 *
 * Wraps ComprehensionLayout + StoryStructureTable.
 * Calls handleFinishStoryStructure from LearningContext when the student
 * clicks "下一關".
 */
import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import StoryStructureTable from '../../components/reading-steps/StoryStructureTable';
import KeypointsFollowupQuestions from '../../components/reading-steps/KeypointsFollowupQuestions';
import { useLearningContext } from '../../layouts/LearningLayout';
import NextStepFooter from '../../components/learning/NextStepFooter';

const KeypointsTablePage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishStoryStructure,
    dbSessionId,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();

  const handleProgressChange = useCallback(
    (stepData: Record<string, unknown>, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'keypoints-table',
        stepData,
        currentStep: 'keypoints-table',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  const handleNext = useCallback(() => {
    handleProgressChange({ completed: true }, true);
    handleFinishStoryStructure();
  }, [handleFinishStoryStructure, handleProgressChange]);

  if (!selectedStory) return null;

  return (
    <ComprehensionLayout
      story={selectedStory}
      dbSessionId={dbSessionId ?? undefined}
      exerciseIcon="summarize"
      exerciseLabel="文章重點表"
    >
      <StoryStructureTable storyId={selectedStory.id} />

      {/* 第一篇專屬加碼題 (#2752 Phase 3, L0063-shape keypointsFollowupQuestions —
          the `items` shape belongs to full-text-annotate instead, see FullTextAnnotate.tsx). */}
      {selectedStory.keypointsFollowupQuestions?.questions && (
        <KeypointsFollowupQuestions
          instruction={selectedStory.keypointsFollowupQuestions.instruction}
          questions={selectedStory.keypointsFollowupQuestions.questions}
        />
      )}

      <NextStepFooter onNext={handleNext} />
    </ComprehensionLayout>
  );
};

export default KeypointsTablePage;
