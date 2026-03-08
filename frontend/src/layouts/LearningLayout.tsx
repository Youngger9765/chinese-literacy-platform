import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useParams, useNavigate, useOutletContext } from 'react-router-dom';
import {
  Story,
  ReadingAttempt,
  LearningSession,
  ComprehensionResult,
  VocabResult,
  FullReadingResult,
} from '../types';
import { fetchStory } from '../services/api';
import { useLearningNav } from '../contexts/LearningNavContext';

const EMPTY_ATTEMPT: ReadingAttempt = {
  storyId: '',
  accuracy: 0,
  fluency: 0,
  cpm: 0,
  mispronouncedWords: [],
  transcription: '',
  timestamp: 0,
};

export interface LearningContext {
  selectedStory: Story | null;
  session: LearningSession | null;
  lastAttempt: ReadingAttempt | null;
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;
  handleStartReading: () => void;
  handleFinishReading: (attempt: ReadingAttempt) => void;
  handleFinishComprehension: (result: ComprehensionResult) => void;
  handleFinishVocab: (result: VocabResult) => void;
  handleFinishFullReading: (result: FullReadingResult) => void;
  handleRetry: () => void;
  emptyAttempt: ReadingAttempt;
}

/**
 * Wraps the learning flow routes (/learn/:storyId/*).
 * Manages shared state: selectedStory, session, lastAttempt, rightPanelWidth.
 * Children access this state via useOutletContext<LearningContext>().
 */
const LearningLayout: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const learningNav = useLearningNav();

  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ReadingAttempt | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync session/story to the nav context so the header StepperNav can read them
  useEffect(() => {
    learningNav.setSession(session);
    learningNav.setSelectedStory(selectedStory);
    return () => {
      learningNav.setSession(null);
      learningNav.setSelectedStory(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedStory]);

  // Load story data when storyId changes
  useEffect(() => {
    if (!storyId) {
      navigate('/library', { replace: true });
      return;
    }

    // If we already have the right story loaded, skip
    if (selectedStory?.id === storyId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchStory(storyId)
      .then((story) => {
        setSelectedStory(story);
        // Only create a new session if we don't have one for this story
        setSession((prev) => {
          if (prev && prev.storyId === storyId) return prev;
          return {
            storyId: story.id,
            startedAt: Date.now(),
            introCompleted: false,
            readingAttempt: null,
            comprehensionResult: null,
            vocabResult: null,
            fullReadingResult: null,
          };
        });
      })
      .catch((err) => {
        setError(err.message || 'Failed to load story');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [storyId, selectedStory?.id, navigate]);

  const handleStartReading = useCallback(() => {
    setSession((prev) => {
      if (prev) return { ...prev, introCompleted: true };
      if (selectedStory) {
        return {
          storyId: selectedStory.id,
          startedAt: Date.now(),
          introCompleted: true,
          readingAttempt: null,
          comprehensionResult: null,
          vocabResult: null,
          fullReadingResult: null,
        };
      }
      return null;
    });
    navigate(`/learn/${storyId}/tutor`);
  }, [storyId, selectedStory, navigate]);

  const handleFinishReading = useCallback(
    (attempt: ReadingAttempt) => {
      setLastAttempt(attempt);
      setSession((prev) => (prev ? { ...prev, readingAttempt: attempt } : null));
      navigate(`/learn/${storyId}/comprehension`);
    },
    [storyId, navigate],
  );

  const handleFinishComprehension = useCallback(
    (result: ComprehensionResult) => {
      setSession((prev) => (prev ? { ...prev, comprehensionResult: result } : null));
      navigate(`/learn/${storyId}/vocab`);
    },
    [storyId, navigate],
  );

  const handleFinishVocab = useCallback(
    (result: VocabResult) => {
      setSession((prev) => (prev ? { ...prev, vocabResult: result } : null));
      navigate(`/learn/${storyId}/full-reading`);
    },
    [storyId, navigate],
  );

  const handleFinishFullReading = useCallback(
    (result: FullReadingResult) => {
      setSession((prev) => (prev ? { ...prev, fullReadingResult: result } : null));
      navigate(`/learn/${storyId}/report`);
    },
    [storyId, navigate],
  );

  const handleRetry = useCallback(() => {
    setSession(null);
    setLastAttempt(null);
    setSelectedStory(null);
    navigate('/library');
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">載入課文中...</span>
        </div>
      </div>
    );
  }

  if (error || !selectedStory) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-600">{error || '找不到此課文'}</p>
          <button
            onClick={() => navigate('/library')}
            className="text-accent hover:text-accent-hover font-medium text-sm"
          >
            返回圖書館
          </button>
        </div>
      </div>
    );
  }

  const ctx: LearningContext = {
    selectedStory,
    session,
    lastAttempt,
    rightPanelWidth,
    setRightPanelWidth,
    handleStartReading,
    handleFinishReading,
    handleFinishComprehension,
    handleFinishVocab,
    handleFinishFullReading,
    handleRetry,
    emptyAttempt: EMPTY_ATTEMPT,
  };

  return <Outlet context={ctx} />;
};

/** Hook for child routes to access learning context. */
export function useLearningContext(): LearningContext {
  return useOutletContext<LearningContext>();
}

export default LearningLayout;
