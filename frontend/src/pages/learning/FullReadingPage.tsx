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
    completedParagraphsSet,
  } = useLearningContext();
  const navigate = useNavigate();

  // Whether the user has seen/dismissed the optional listening prompt (Issue #251)
  const [listeningPromptDismissed, setListeningPromptDismissed] = useState(false);

  if (!selectedStory) return null;

  const totalParagraphs = selectedStory.content.length;
  const allParagraphsDone = completedParagraphsSet.size >= totalParagraphs;

  // Gate: require all paragraphs completed before accessing full reading (Issue #85)
  if (!allParagraphsDone) {
    const remaining = totalParagraphs - completedParagraphsSet.size;
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 bg-amber-50">
        <div className="text-center max-w-md space-y-4">
          {/* Lock icon */}
          <div className="w-20 h-20 rounded-full bg-gray-100 border-2 border-gray-300 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-gray-800">全文朗讀尚未解鎖</h2>
          <p className="text-gray-600 leading-relaxed">
            請先完成逐段朗讀練習，才能進行全文朗讀。
          </p>
          <p className="text-sm text-gray-500">
            目前完成：{completedParagraphsSet.size} / {totalParagraphs} 段
            {remaining > 0 && `，還需完成 ${remaining} 段`}
          </p>

          {/* Progress visual */}
          <div className="flex gap-1.5 h-2.5 justify-center max-w-xs mx-auto">
            {Array.from({ length: totalParagraphs }, (_, idx) => (
              <div
                key={idx}
                className={`flex-1 rounded-full transition-all ${
                  completedParagraphsSet.has(idx) ? 'bg-emerald-500' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={() => navigate(`/learn/${storyId}/tutor`)}
          className="px-8 py-3 rounded-xl font-bold text-base bg-accent hover:bg-accent-hover text-white transition-all shadow active:scale-95"
        >
          返回逐段練習
        </button>
      </div>
    );
  }

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
            className="w-full py-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
