/**
 * ListeningPage — Issue #251
 *
 * Optional step in the learning flow: listening comprehension practice.
 * Route: /learn/:storyId/listening
 */

import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ListeningPractice from '../../components/reading-steps/ListeningPractice';
import { useLearningContext } from '../../layouts/LearningLayout';

const ListeningPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;

  return (
    <ListeningPractice
      story={selectedStory}
      onFinish={(_result) => {
        // Listening is an optional step — navigate forward to full-reading
        navigate(`/learn/${storyId}/full-reading`);
      }}
      onBack={() => navigate(`/learn/${storyId}/dictation`)}
    />
  );
};

export default ListeningPage;
