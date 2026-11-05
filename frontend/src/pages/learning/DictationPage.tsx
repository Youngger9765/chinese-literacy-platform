import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DictationPractice from '../../components/reading-steps/DictationPractice';
import { useLearningContext } from '../../layouts/LearningLayout';
import { isIslandStoryMode } from '../lab/island/storyMode';
import type { DictationStepData } from '../../types/stepProgress';

const DictationPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishDictation,
    stepProgressData,
    saveStepProgressPatch,
  } = useLearningContext();
  const navigate = useNavigate();
  // 喝采島故事模式：不顯示「返回上一步」——PRD §2「一次一關」要求學生在島上
  // 進站後不會被帶去別的 step。dictation 目前全站停用、不在任何島的 15 種
  // step id 裡，今天沒有島會真的載入這頁，但照 Young 的指示不賭「用不到」。
  const storyMode = isIslandStoryMode();

  const handleProgressChange = useCallback(
    (stepData: DictationStepData, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'dictation',
        stepData,
        currentStep: 'dictation',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  if (!selectedStory) return null;

  return (
    <DictationPractice
      story={selectedStory}
      onFinish={handleFinishDictation}
      onBack={storyMode ? undefined : () => navigate(`/learn/${storyId}/character-practice`)}
      initialProgress={stepProgressData.step_data?.dictation as DictationStepData | undefined}
      onProgressChange={handleProgressChange}
    />
  );
};

export default DictationPage;
