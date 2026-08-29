import React, { useCallback, useRef } from 'react';
import VocabWordSearch from '../../components/reading-steps/VocabWordSearch';
import type { WordSearchProgress } from '../../components/reading-steps/useWordSearchProgress';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabReviewPage: React.FC = () => {
  const {
    selectedStory,
    handleFinishVocabWordSearch,
    saveStepProgressPatch,
    stepProgressData,
  } = useLearningContext();

  // #2848：這一步先前存下的進度快照。用 ref 凍結在「第一次 render 當下」的值 ——
  // VocabWordSearch 的還原是 lazy initializer（只在 mount 讀一次），若讓它跟著每次
  // patch 後的新 stepProgressData 變動，讀到的會是自己剛寫回去的值。
  // LearningLayout 的 waitingForProgress gate（#1549）保證 DB 載完才 render 這一頁。
  const restoredRef = useRef<WordSearchProgress | null | undefined>(undefined);
  if (restoredRef.current === undefined) {
    const fromDb = (stepProgressData?.step_data as Record<string, unknown> | undefined)?.[
      'vocab-review'
    ];
    restoredRef.current =
      fromDb && typeof fromDb === 'object' ? (fromDb as WordSearchProgress) : null;
  }

  const handleProgressChange = useCallback(
    (progress: WordSearchProgress) => {
      if (!saveStepProgressPatch) return;
      // 遊戲中的快照 —— **不可以** markCompleted。標了完成，學生才找到一個詞報告頁
      // 就會把整步算成做完。交卷走 handleFinishVocabWordSearch 那條。
      // immediate: false 讓 useProgressSync 的 debounce 把連續作答收斂成一次 PUT。
      saveStepProgressPatch({
        stepId: 'vocab-review',
        currentStep: 'vocab-review',
        immediate: false,
        stepData: {
          foundWords: progress.foundWords,
          elapsedTime: progress.elapsedTime,
          ...(progress.completed ? { completed: true } : {}),
        },
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <VocabWordSearch
      story={selectedStory}
      onFinish={handleFinishVocabWordSearch}
      initialProgress={restoredRef.current}
      onProgressChange={handleProgressChange}
    />
  );
};

export default VocabReviewPage;
