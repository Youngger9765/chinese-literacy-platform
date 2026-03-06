import React, { createContext, useContext, useState, useCallback } from 'react';
import { Story, LearningSession } from '../types';

interface LearningNavContextValue {
  session: LearningSession | null;
  selectedStory: Story | null;
  setSession: (session: LearningSession | null) => void;
  setSelectedStory: (story: Story | null) => void;
}

const LearningNavContext = createContext<LearningNavContextValue>({
  session: null,
  selectedStory: null,
  setSession: () => {},
  setSelectedStory: () => {},
});

export function useLearningNav(): LearningNavContextValue {
  return useContext(LearningNavContext);
}

export const LearningNavProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<LearningSession | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);

  return (
    <LearningNavContext.Provider value={{ session, selectedStory, setSession, setSelectedStory }}>
      {children}
    </LearningNavContext.Provider>
  );
};
