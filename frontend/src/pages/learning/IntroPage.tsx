import React from 'react';
import { useNavigate } from 'react-router-dom';
import Intro from '../../components/reading-steps/Intro';
import { useLearningContext } from '../../layouts/LearningLayout';

const IntroPage: React.FC = () => {
  const { selectedStory, handleStartReading } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <Intro
      story={selectedStory}
      onStartReading={handleStartReading}
      onBack={() => navigate('/library')}
    />
  );
};

export default IntroPage;
