/**
 * ListeningPage — Issue #251 / #1098
 *
 * Optional step in the learning flow: listening comprehension practice.
 * Route: /learn/:storyId/listening
 *
 * Issue #1098: use handleFinishListening from LearningLayout context so that
 * completing this step persists to DB (step_progress.steps_completed).
 * Previously the inline onFinish only called navigate(), leaving no DB record.
 */

import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ListeningPractice from '../../components/reading-steps/ListeningPractice';
import { useLearningContext } from '../../layouts/LearningLayout';

const ListeningPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory, handleFinishListening } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <ListeningPractice
      story={selectedStory}
      onFinish={handleFinishListening}
      onBack={() => navigate(`/learn/${storyId}/key-passage-reading`)}
    />
  );
};

export default ListeningPage;
