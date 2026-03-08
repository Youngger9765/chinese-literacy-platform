import React from 'react';
import { useNavigate } from 'react-router-dom';
import LiveTutor from '../../components/reading-steps/LiveTutor';
import { useLearningContext } from '../../layouts/LearningLayout';

const TutorPage: React.FC = () => {
  const { selectedStory, rightPanelWidth, setRightPanelWidth, handleFinishReading } =
    useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <LiveTutor
      story={selectedStory}
      rightPanelWidth={rightPanelWidth}
      onPanelWidthChange={setRightPanelWidth}
      onFinish={handleFinishReading}
      onCancel={() => navigate('/library')}
    />
  );
};

export default TutorPage;
