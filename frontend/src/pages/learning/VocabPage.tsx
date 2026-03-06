import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import VocabPractice from '../../components/reading-steps/VocabPractice';
import { useLearningContext } from '../../layouts/LearningLayout';

const VocabPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, lastAttempt, handleFinishVocab, emptyAttempt } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <VocabPractice
      story={selectedStory}
      attempt={lastAttempt ?? emptyAttempt}
      onFinish={handleFinishVocab}
      onBack={() => navigate(`/learn/${storyId}/comprehension`)}
    />
  );
};

export default VocabPage;
