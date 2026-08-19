import React from 'react';
import ClassicalWordMatching from '../../components/reading-steps/ClassicalWordMatching';
import { useLearningContext } from '../../layouts/LearningLayout';

const ClassicalWordMatchingPage: React.FC = () => {
  const { selectedStory, handleFinishClassicalWordMatching } = useLearningContext();

  if (!selectedStory) return null;

  return <ClassicalWordMatching story={selectedStory} onFinish={handleFinishClassicalWordMatching} />;
};

export default ClassicalWordMatchingPage;
