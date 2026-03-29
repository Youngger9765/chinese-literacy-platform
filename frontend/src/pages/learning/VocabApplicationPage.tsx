import React from 'react';
import VocabApplication from '../../components/reading-steps/VocabApplication';
import { useLearningContext } from '../../layouts/LearningLayout';
import { useAuth } from '../../contexts/AuthContext';

const VocabApplicationPage: React.FC = () => {
  const { selectedStory, handleFinishVocabApplication, dbSessionId, syncProgress, flushProgress } = useLearningContext();
  const { token } = useAuth();

  if (!selectedStory) return null;

  return (
    <VocabApplication
      story={selectedStory}
      onFinish={handleFinishVocabApplication}
      token={token ?? null}
      dbSessionId={dbSessionId}
      syncProgress={syncProgress}
      flushProgress={flushProgress}
    />
  );
};

export default VocabApplicationPage;
