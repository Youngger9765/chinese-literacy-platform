import React from 'react';
import ReadingAnnotation from '../../components/reading-steps/ReadingAnnotation';
import { useLearningContext } from '../../layouts/LearningLayout';

const ReadingAnnotationPage: React.FC = () => {
  const { selectedStory, handleFinishReadingAnnotation } = useLearningContext();

  if (!selectedStory) return null;

  return (
    <ReadingAnnotation
      story={selectedStory}
      onFinish={handleFinishReadingAnnotation}
    />
  );
};

export default ReadingAnnotationPage;
