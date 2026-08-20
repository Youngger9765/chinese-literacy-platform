import React from 'react';
import ClassicalSentenceMatching from '../../components/reading-steps/ClassicalSentenceMatching';
import { useLearningContext } from '../../layouts/LearningLayout';

const ClassicalSentenceMatchingPage: React.FC = () => {
  const { selectedStory, handleFinishClassicalSentenceMatching } = useLearningContext();

  if (!selectedStory) return null;

  return <ClassicalSentenceMatching story={selectedStory} onFinish={handleFinishClassicalSentenceMatching} />;
};

export default ClassicalSentenceMatchingPage;
