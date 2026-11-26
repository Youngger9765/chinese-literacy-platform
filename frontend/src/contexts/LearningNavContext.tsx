import React, { createContext, useContext, useState, useCallback } from 'react';
import { Story, LearningSession } from '../types';
import type { StepProgressData } from '../services/learningApi';

interface LearningNavContextValue {
  session: LearningSession | null;
  selectedStory: Story | null;
  setSession: (session: LearningSession | null) => void;
  setSelectedStory: (story: Story | null) => void;
  /** #4028：每一關的作答資料（step_data），上方導覽列用它判斷哪一關要畫黃色圈圈。 */
  stepProgress: StepProgressData | null;
  setStepProgress: (progress: StepProgressData | null) => void;
}

const LearningNavContext = createContext<LearningNavContextValue>({
  session: null,
  selectedStory: null,
  setSession: () => {},
  setSelectedStory: () => {},
  stepProgress: null,
  setStepProgress: () => {},
});

export function useLearningNav(): LearningNavContextValue {
  return useContext(LearningNavContext);
}

export const LearningNavProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<LearningSession | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [stepProgress, setStepProgress] = useState<StepProgressData | null>(null);

  return (
    <LearningNavContext.Provider
      value={{ session, selectedStory, setSession, setSelectedStory, stepProgress, setStepProgress }}
    >
      {children}
    </LearningNavContext.Provider>
  );
};
