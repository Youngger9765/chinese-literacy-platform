import React from 'react';
import ClassicalSelfChallenge from '../../components/reading-steps/ClassicalSelfChallenge';
import { useLearningContext } from '../../layouts/LearningLayout';

const ClassicalSelfChallengePage: React.FC = () => {
  const { selectedStory, handleFinishClassicalSelfChallenge } = useLearningContext();

  if (!selectedStory) return null;

  return <ClassicalSelfChallenge story={selectedStory} onFinish={handleFinishClassicalSelfChallenge} />;
};

export default ClassicalSelfChallengePage;
