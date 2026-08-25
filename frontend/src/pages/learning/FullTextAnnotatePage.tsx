import React from 'react';
import { sectionSlugForStep } from '../../config/roundScope';
import { moduleForStep } from '../../config/stepConfig';
import { useCurrentSectionSlug } from '../../hooks/useCurrentStepId';
import ReadingAnnotation from '../../components/reading-steps/FullTextAnnotate';
import { useLearningContext } from '../../layouts/LearningLayout';

const FullTextAnnotatePage: React.FC = () => {
  const { selectedStory, handleFinishReadingAnnotation, dbSessionId } = useLearningContext();
  // QR 要印這一節自己的代號（#2916）—— 頁面在 Router 裡，葉元件不是
  // 多篇課從網址的 `?p=` 拿；單篇課網址沒有 `?p=`，改從帳本拿 ——
  // 只靠網址的話 170 課的 QR 會退回長網址（#2916）。
  const sectionSlug = useCurrentSectionSlug()
    ?? sectionSlugForStep(selectedStory?.manifestSections, 'full-text-annotate', moduleForStep);

  if (!selectedStory) return null;

  return (
    <ReadingAnnotation
      sectionSlug={sectionSlug}
      story={selectedStory}
      onFinish={handleFinishReadingAnnotation}
      dbSessionId={dbSessionId}
    />
  );
};

export default FullTextAnnotatePage;
