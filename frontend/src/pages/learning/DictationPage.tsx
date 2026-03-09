import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DictationPractice from '../../components/reading-steps/DictationPractice';
import { useLearningContext } from '../../layouts/LearningLayout';

const DictationPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, handleFinishDictation } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <DictationPractice
      story={selectedStory}
      onFinish={handleFinishDictation}
      onBack={() => navigate(`/learn/${storyId}/vocab`)}
    />
  );
};

export default DictationPage;
