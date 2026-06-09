/**
 * StoryStructurePage — Step: 文章重點表 (story-structure, dbStep 15)
 *
 * Wraps ComprehensionLayout + StoryStructureTable.
 * Calls handleFinishStoryStructure from LearningContext when the student
 * clicks "下一關".
 */
import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import StoryStructureTable from '../../components/reading-steps/StoryStructureTable';
import { useLearningContext } from '../../layouts/LearningLayout';

const StoryStructurePage: React.FC = () => {
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
        stepId: 'story-structure',
        stepData,
        currentStep: 'story-structure',
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
      {/* Entry visibility banner (#2084 — 讓入口更明顯，說明功能用途) */}
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="material-symbols-outlined text-amber-500 shrink-0" style={{ fontSize: '18px' }}>
          account_tree
        </span>
        <span>
          <strong>文章重點表：</strong>用思維導圖整理這篇文章的核心架構，看清問題、解決方法與結果之間的關係。
        </span>
      </div>

      <StoryStructureTable storyId={selectedStory.id} />

      {/* Bottom CTA — always available (student may advance after inspecting the table) */}
      <div className="mt-6 shrink-0">
        <button
          onClick={handleNext}
          className="w-full h-12 rounded-full font-headline font-bold text-base text-white shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
        >
          <span>下一關</span>
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </button>
      </div>
    </ComprehensionLayout>
  );
};

export default StoryStructurePage;
