import React from 'react';
import { useCurrentSectionSlug } from '../../hooks/useCurrentStepId';
import ReadingAnnotation from '../../components/reading-steps/FullTextAnnotate';
import { useLearningContext } from '../../layouts/LearningLayout';

const FullTextAnnotatePage: React.FC = () => {
  const { selectedStory, handleFinishReadingAnnotation, dbSessionId } = useLearningContext();
  // QR 要印這一節自己的代號（#2916）—— 頁面在 Router 裡，葉元件不是
  const sectionSlug = useCurrentSectionSlug();

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
