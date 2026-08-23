import React, { useRef } from 'react';
import VocabApplication from '../../components/reading-steps/VocabApplication';
import OmoPaperResultBanner from '../../components/reading-steps/OmoPaperResultBanner';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabApplicationPage: React.FC = () => {
  const {
    selectedStory,
    handleFinishVocabApplication,
    saveStepProgressPatch,
    stepProgressData,
  } = useLearningContext();

  // #2848：這一步先前存下的進度快照。用 ref 凍結在「第一次 render 當下」的值 ——
  // VocabApplication 的還原也是 lazy initializer（只在 mount 讀一次），若讓它跟著
  // 每次 patch 後的新 stepProgressData 變動，讀到的會是自己剛寫回去的值。
  // LearningLayout 的 waitingForProgress gate（#1549）保證 DB 載完才 render 這一頁。
  const savedStepDataRef = useRef<Record<string, unknown> | null>(null);
  if (savedStepDataRef.current === null) {
    const fromDb = (stepProgressData?.step_data as Record<string, unknown> | undefined)?.[
      'vocab-application'
    ];
    savedStepDataRef.current = (fromDb && typeof fromDb === 'object' ? fromDb : {}) as Record<
      string,
      unknown
    >;
  }

  if (!selectedStory) return null;

  return (
    <>
      <OmoPaperResultBanner stepId="vocab-application" />
      <VocabApplication
        story={selectedStory}
        onFinish={handleFinishVocabApplication}
        saveStepProgressPatch={saveStepProgressPatch}
        initialProgress={savedStepDataRef.current}
      />
    </>
  );
};

export default VocabApplicationPage;
