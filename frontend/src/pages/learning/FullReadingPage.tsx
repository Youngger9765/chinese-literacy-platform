import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import FullReading from '../../components/reading-steps/FullReading';
import { useLearningContext } from '../../layouts/LearningLayout';

const FullReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishFullReading,
    session,
  } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <FullReading
      story={selectedStory}
      onFinish={handleFinishFullReading}
      onBack={() => navigate(`/learn/${storyId}/tutor`)}
      initialResult={session?.fullReadingResult ?? null}
    />
  );
};

export default FullReadingPage;
