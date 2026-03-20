/**
 * OnboardingGuide — Step-by-step welcome overlay for first-time student users.
 *
 * Shows 4 steps with child-friendly language (9-12 year olds).
 * Calls POST /api/auth/complete-onboarding on completion.
 * Can be skipped at any step.
 */

import React, { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

interface OnboardingGuideProps {
  userName: string;
  token: string;
  onComplete: () => void;
}

interface Step {
  emoji: string;
  title: string;
  description: string;
  bgColor: string;
}

const STEPS: Step[] = [
  {
    emoji: '👋',
    title: '歡迎來到朗朗上口！',
    description: '嗨！很高興見到你！這裡是你的國語文朗讀練習基地，讓我帶你認識一下這個地方吧！',
    bgColor: 'bg-yellow-50',
  },
  {
    emoji: '📚',
    title: '選擇你喜歡的課文',
    description: '點擊「進入圖書館」，就可以看到很多有趣的故事！選一篇你喜歡的，就可以開始學習囉！',
    bgColor: 'bg-blue-50',
  },
  {
    emoji: '🎯',
    title: '七個步驟，一起學習',
    description: '每篇課文都有七個學習步驟：認識課文、逐段朗讀、課文理解、生字練習、聽寫練習、全文朗讀，最後看你的成績報告！',
    bgColor: 'bg-green-50',
  },
  {
    emoji: '🌟',
    title: '準備好了嗎？',
    description: '太棒了！你已經了解怎麼使用這個平台了！記得要認真練習，每天進步一點點，你就會越來越厲害！',
    bgColor: 'bg-purple-50',
  },
];

async function callCompleteOnboarding(token: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/complete-onboarding`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Non-blocking — if the API call fails, the UI still proceeds.
    // The onboarding flag may not be set, but the user won't be stuck.
  }
}

const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ userName, token, onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      handleFinish();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleFinish = async () => {
    setIsClosing(true);
    await callCompleteOnboarding(token);
    onComplete();
  };

  const handleSkip = async () => {
    setIsClosing(true);
    await callCompleteOnboarding(token);
    onComplete();
  };

  if (isClosing) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={handleSkip} />

      {/* Modal card */}
      <div
        className={`relative w-full max-w-md mx-auto rounded-3xl shadow-2xl overflow-hidden ${step.bgColor} border-4 border-white`}
        style={{ maxHeight: '90vh' }}
      >
        {/* Skip button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors z-10"
        >
          跳過
        </button>

        {/* Content area */}
        <div className="flex flex-col items-center px-8 pt-12 pb-8 text-center">
          {/* Illustration / Emoji */}
          <div className="text-8xl mb-6 select-none" role="img" aria-label={step.title}>
            {step.emoji}
          </div>

          {/* Step title */}
          <h2 className="text-2xl font-black text-gray-800 mb-4 leading-tight">
            {currentStep === 0 ? (
              <>
                {step.title}
                <br />
                <span className="text-accent text-xl">{userName} 同學！</span>
              </>
            ) : (
              step.title
            )}
          </h2>

          {/* Step description */}
          <p className="text-gray-600 text-lg leading-relaxed mb-8">
            {step.description}
          </p>

          {/* Progress dots */}
          <div className="flex gap-2 mb-8">
            {STEPS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentStep(idx)}
                className={`w-3 h-3 rounded-full transition-all duration-200 ${
                  idx === currentStep
                    ? 'bg-accent w-6'
                    : idx < currentStep
                    ? 'bg-accent opacity-50'
                    : 'bg-gray-300'
                }`}
                aria-label={`步驟 ${idx + 1}`}
              />
            ))}
          </div>

          {/* Next / Finish button */}
          <button
            onClick={handleNext}
            className="w-full py-4 rounded-2xl font-black text-xl text-white bg-accent hover:bg-accent-hover active:scale-95 transition-all duration-150 shadow-lg"
          >
            {isLastStep ? '開始學習！' : '下一步'}
          </button>

          {/* Step counter */}
          <p className="mt-4 text-sm text-gray-400">
            {currentStep + 1} / {STEPS.length}
          </p>
        </div>
      </div>
    </div>
  );
};

export default OnboardingGuide;
