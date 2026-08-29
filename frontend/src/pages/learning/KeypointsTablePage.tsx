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
import { useCurrentSectionSlug } from '../../hooks/useCurrentStepId';
import NextStepFooter from '../../components/learning/NextStepFooter';

const KeypointsTablePage: React.FC = () => {
  // 這一步屬於哪一篇（多篇課才有）——重點表要跟著篇次走（#2930）。
  const roundSlug = useCurrentSectionSlug();
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishStoryStructure,
    dbSessionId,
    stepProgressData,
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

  // #2833 — the last-persisted { answers, gradeResult } for this step, restored
  // once on mount by StoryStructureTable. Without this, and without wiring
  // handleProgressChange in as onProgressChange below, filled-in answers were
  // never sent to saveStepProgressPatch at all — a reload always came back blank.
  const initialProgress = (stepProgressData.step_data?.['keypoints-table'] as
    | Record<string, unknown>
    | undefined) ?? undefined;

  return (
    <ComprehensionLayout
      story={selectedStory}
      dbSessionId={dbSessionId ?? undefined}
      exerciseIcon="summarize"
      exerciseLabel="文章重點表"
    >
      <StoryStructureTable
        storyId={selectedStory.id}
        roundSlug={roundSlug ?? undefined}
        initialProgress={initialProgress}
        onProgressChange={handleProgressChange}
      />

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
