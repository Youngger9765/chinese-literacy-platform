import React from 'react';
import ClassicalText from '../../components/reading-steps/ClassicalText';
import { useLearningContext } from '../../layouts/LearningLayout';

const ClassicalTextPage: React.FC = () => {
  const { selectedStory, handleFinishClassicalText } = useLearningContext();

  if (!selectedStory) return null;

  return <ClassicalText story={selectedStory} onFinish={handleFinishClassicalText} />;
};

export default ClassicalTextPage;
