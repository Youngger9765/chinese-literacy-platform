import React from 'react';
import ReadingAnnotation from '../../components/reading-steps/FullTextAnnotate';
import { useLearningContext } from '../../layouts/LearningLayout';

const FullTextAnnotatePage: React.FC = () => {
  const { selectedStory, handleFinishReadingAnnotation, dbSessionId } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <ReadingAnnotation
      story={selectedStory}
      onFinish={handleFinishReadingAnnotation}
      dbSessionId={dbSessionId}
    />
  );
};

export default FullTextAnnotatePage;
