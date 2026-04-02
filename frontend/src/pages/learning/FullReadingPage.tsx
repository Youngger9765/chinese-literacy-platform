import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import FullReading from '../../components/reading-steps/FullReading';
import { useLearningContext } from '../../layouts/LearningLayout';

const FullReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    rightPanelWidth,
    setRightPanelWidth,
    handleFinishFullReading,
  } = useLearningContext();
  const navigate = useNavigate();

  // Whether the user has seen/dismissed the optional listening prompt (Issue #251)
  const [listeningPromptDismissed, setListeningPromptDismissed] = useState(false);

  if (!selectedStory) return null;

  // Optional: offer listening comprehension practice before full reading (Issue #251)
  if (!listeningPromptDismissed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 max-w-md mx-auto text-center">
        <div className="text-5xl" aria-hidden="true">🎧</div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-gray-900">想挑戰聽力理解嗎？</h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            聽力理解練習是選做題目。聽完課文後，試著用自己的話說出重點，AI 會給你評分和回饋！
          </p>
        </div>

        <div className="w-full space-y-3">
          <button
            type="button"
            onClick={() => navigate(`/learn/${storyId}/listening`)}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-full font-bold text-sm shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            進行聽力理解練習
          </button>

          <button
            type="button"
            onClick={() => setListeningPromptDismissed(true)}
            className="w-full py-3 border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-xl font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            跳過，直接全文朗讀 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <FullReading
      story={selectedStory}
      rightPanelWidth={rightPanelWidth}
      onPanelWidthChange={setRightPanelWidth}
      onFinish={handleFinishFullReading}
      onBack={() => navigate(`/learn/${storyId}/vocab`)}
    />
  );
};

export default FullReadingPage;
