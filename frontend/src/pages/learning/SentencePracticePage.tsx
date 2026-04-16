import React, { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SentencePractice from '../../components/reading-steps/SentencePractice';
import { useLearningContext } from '../../layouts/LearningLayout';

const SentencePracticePage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { selectedStory } = useLearningContext();
  const navigate = useNavigate();

  const practicedWords = useMemo(() => {
    if (!selectedStory?.vocabulary) return [];
    const seen = new Set<string>();
    const words: string[] = [];
    for (const item of selectedStory.vocabulary) {
      const w = item.word.trim();
      if (w && !seen.has(w)) { words.push(w); seen.add(w); }
    }
    return words;
  }, [selectedStory?.vocabulary]);

  if (!selectedStory) return null;

  return (
    <SentencePractice
      practicedWords={practicedWords}
      storyTitle={selectedStory.title}
      onFinish={() => navigate(`/learn/${storyId}/vocab-definition`)}
      onBack={() => navigate(`/learn/${storyId}/vocab`)}
    />
  );
};

export default SentencePracticePage;
