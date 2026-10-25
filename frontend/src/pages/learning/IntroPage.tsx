import React from 'react';
import { useNavigate } from 'react-router-dom';
import Intro from '../../components/reading-steps/Intro';
import { useLearningContext } from '../../layouts/LearningLayout';
import { isIslandStoryMode } from '../lab/island/storyMode';

const IntroPage: React.FC = () => {
  const { selectedStory, handleStartReading } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;
  const storyMode = isIslandStoryMode();

  return (
    <Intro
      story={selectedStory}
      onStartReading={handleStartReading}
      onBack={storyMode ? undefined : () => navigate('/library')}
      storyMode={storyMode}
    />
  );
};

export default IntroPage;
