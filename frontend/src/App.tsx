
import React, { useState } from 'react';
import { AppView, Story, ReadingAttempt, LearningSession, ComprehensionResult, VocabResult, FullReadingResult } from './types';
import { useIsMobile } from './hooks/useIsMobile';
import StoryLibrary from './pages/student/StoryLibrary';
import Intro from './components/reading-steps/Intro';
import LiveTutor from './components/reading-steps/LiveTutor';
import VocabPractice from './components/reading-steps/VocabPractice';
import ComprehensionChat from './components/reading-steps/ComprehensionChat';
import FullReading from './components/reading-steps/FullReading';
import AssessmentReport from './components/reading-steps/AssessmentReport';
import WriteCharacter from './components/stroke-order/WriteCharacter';

const EMPTY_ATTEMPT: ReadingAttempt = {
  storyId: '',
  accuracy: 0,
  fluency: 0,
  cpm: 0,
  mispronouncedWords: [],
  transcription: '',
  timestamp: 0,
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.HOME);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ReadingAttempt | null>(null);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [writingChar, setWritingChar] = useState('');
  const [writeInput, setWriteInput] = useState('');
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleSelectStory = (story: Story) => {
    setSelectedStory(story);
    setSession({
      storyId: story.id,
      startedAt: Date.now(),
      readingAttempt: null,
      comprehensionResult: null,
      vocabResult: null,
      fullReadingResult: null,
    });
    setView(AppView.INTRO);
  };

  const handleStartReading = () => {
    setView(AppView.TUTOR);
  };

  const handleFinishReading = (attempt: ReadingAttempt) => {
    setLastAttempt(attempt);
    setSession(prev => prev ? { ...prev, readingAttempt: attempt } : null);
    setView(AppView.COMPREHENSION);
  };

  const handleFinishComprehension = (result: ComprehensionResult) => {
    setSession(prev => prev ? { ...prev, comprehensionResult: result } : null);
    setView(AppView.VOCAB);
  };

  const handleFinishVocab = (result: VocabResult) => {
    setSession(prev => prev ? { ...prev, vocabResult: result } : null);
    setView(AppView.FULL_READING);
  };

  const steps = [
    { step: 1, label: '簡介',    view: AppView.INTRO,         needsStory: true  },
    { step: 2, label: '逐段朗讀', view: AppView.TUTOR,         needsStory: true  },
    { step: 3, label: '生字練習', view: AppView.VOCAB,         needsStory: true  },
    { step: 4, label: '課文理解', view: AppView.COMPREHENSION, needsStory: true  },
    { step: 5, label: '全文朗讀', view: AppView.FULL_READING,  needsStory: true  },
    { step: 6, label: '報告',    view: AppView.REPORT,        needsStory: false },
  ] as const;

  return (
    <div className="h-screen flex flex-col bg-amber-50 text-gray-900 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 h-12 flex items-center justify-between px-4 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 cursor-pointer shrink-0" onClick={() => setView(AppView.HOME)}>
          <div className="bg-accent w-6 h-6 rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs">L</span>
          </div>
          <span className="text-sm font-bold text-gray-800 hidden sm:block">AI Reading Tutor</span>
        </div>

        {/* Step Navigation (upper right) */}
        {isMobile ? (
          <nav className="flex items-center gap-1 text-[11px] font-medium relative">
            {/* Compact step circles */}
            {steps.map(({ step, view: targetView, needsStory }) => {
              const isActive = view === targetView;
              const isDisabled = needsStory && !selectedStory;
              return (
                <button
                  key={targetView}
                  onClick={() => { if (!isDisabled) { setView(targetView); setMobileNavOpen(false); } }}
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 transition-colors ${
                    isActive ? 'bg-accent text-white' : isDisabled ? 'bg-gray-200 text-gray-400' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {step}
                </button>
              );
            })}

            {/* Hamburger */}
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="ml-1 p-1 rounded hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Dropdown */}
            {mobileNavOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMobileNavOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[160px]">
                  <button
                    onClick={() => { setView(AppView.HOME); setMobileNavOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                      view === AppView.HOME ? 'bg-accent/10 text-accent font-bold' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    首頁
                  </button>
                  {steps.map(({ step, label, view: targetView, needsStory }) => {
                    const isActive = view === targetView;
                    const isDisabled = needsStory && !selectedStory;
                    return (
                      <button
                        key={targetView}
                        onClick={() => { if (!isDisabled) { setView(targetView); setMobileNavOpen(false); } }}
                        disabled={isDisabled}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                          isActive ? 'bg-accent/10 text-accent font-bold'
                          : isDisabled ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                          isActive ? 'bg-accent text-white' : isDisabled ? 'bg-gray-200 text-gray-400' : 'bg-gray-200 text-gray-700'
                        }`}>
                          {step}
                        </span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Avatar */}
            <div className="ml-2 flex items-center gap-1 pl-2 border-l border-gray-200">
              <div className="w-6 h-6 rounded-full bg-gray-200"></div>
            </div>
          </nav>
        ) : (
          <nav className="flex items-center gap-1 text-[11px] font-medium">
            {/* 首頁 */}
            <button
              onClick={() => setView(AppView.HOME)}
              className={`px-2 py-1 rounded transition-colors ${
                view === AppView.HOME
                  ? 'bg-accent text-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              首頁
            </button>

            <span className="text-gray-300 select-none">·</span>

            {/* Steps 1–6 */}
            {steps.map(({ step, label, view: targetView, needsStory }, i, arr) => {
              const isActive = view === targetView;
              const isDisabled = needsStory && !selectedStory;
              return (
                <React.Fragment key={targetView}>
                  <button
                    onClick={() => !isDisabled && setView(targetView)}
                    className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                      isActive
                        ? 'bg-accent text-white'
                        : isDisabled
                        ? 'text-gray-400 cursor-not-allowed'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                      isActive ? 'bg-white text-accent' : isDisabled ? 'bg-gray-300 text-gray-400' : 'bg-gray-200 text-gray-900'
                    }`}>
                      {step}
                    </span>
                    <span className="hidden md:block">{label}</span>
                  </button>
                  {i < arr.length - 1 && (
                    <span className="text-gray-300 select-none">·</span>
                  )}
                </React.Fragment>
              );
            })}

            {/* User avatar */}
            <div className="ml-3 flex items-center gap-1 pl-3 border-l border-gray-200">
              <div className="w-6 h-6 rounded-full bg-gray-200"></div>
              <span className="text-[10px] text-gray-500 hidden sm:block">Lv.12</span>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {view === AppView.HOME && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
            <h1 className="text-5xl font-black text-gray-900">AI 朗讀助教</h1>
            <p className="text-gray-600 max-w-md">準備好開始今天的朗讀挑戰了嗎？</p>
            <button 
              onClick={() => setView(AppView.LIBRARY)}
              className="bg-accent hover:bg-accent-hover text-white px-10 py-4 rounded-xl font-bold shadow-2xl transition-all"
            >
              進入圖書館
            </button>
          </div>
        )}

        {view === AppView.LIBRARY && (
          <div className="p-8 max-w-7xl mx-auto w-full overflow-y-auto">
            <StoryLibrary onStartReading={handleSelectStory} />
          </div>
        )}

        {view === AppView.INTRO && selectedStory && (
          <Intro
            story={selectedStory}
            onStartReading={handleStartReading}
            onBack={() => setView(AppView.LIBRARY)}
          />
        )}

        {view === AppView.TUTOR && selectedStory && (
          <LiveTutor
            story={selectedStory}
            rightPanelWidth={rightPanelWidth}
            onPanelWidthChange={setRightPanelWidth}
            onFinish={handleFinishReading}
            onCancel={() => setView(AppView.LIBRARY)}
          />
        )}

        {view === AppView.COMPREHENSION && selectedStory && (
          <ComprehensionChat
            story={selectedStory}
            attempt={lastAttempt ?? EMPTY_ATTEMPT}
            rightPanelWidth={rightPanelWidth}
            onPanelWidthChange={setRightPanelWidth}
            onFinish={handleFinishComprehension}
            onBack={() => setView(AppView.TUTOR)}
          />
        )}

        {view === AppView.VOCAB && selectedStory && (
          <VocabPractice
            story={selectedStory}
            attempt={lastAttempt ?? EMPTY_ATTEMPT}
            onFinish={handleFinishVocab}
            onBack={() => setView(AppView.COMPREHENSION)}
          />
        )}

        {view === AppView.FULL_READING && selectedStory && (
          <FullReading
            story={selectedStory}
            rightPanelWidth={rightPanelWidth}
            onPanelWidthChange={setRightPanelWidth}
            onFinish={(result: FullReadingResult) => {
              setSession(prev => prev ? { ...prev, fullReadingResult: result } : null);
              setView(AppView.REPORT);
            }}
            onBack={() => setView(AppView.VOCAB)}
          />
        )}

        {view === AppView.REPORT && (
          <div className="p-8 max-w-4xl mx-auto w-full">
             <AssessmentReport session={session} story={selectedStory} onRetry={() => { setView(AppView.LIBRARY); setSession(null); setLastAttempt(null); }} />
          </div>
        )}

        {view === AppView.WRITE && (
          writingChar ? (
            <WriteCharacter
              character={writingChar}
              onComplete={() => { setWritingChar(''); }}
              onBack={() => { setWritingChar(''); }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <h2 className="text-2xl font-bold text-gray-900">寫字練習</h2>
              <p className="text-gray-600 text-sm">輸入一個中文字，開始練習寫字</p>
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  value={writeInput}
                  onChange={e => setWriteInput(e.target.value.slice(-1))}
                  placeholder="輸入一個字"
                  maxLength={1}
                  className="w-24 h-12 text-center text-2xl bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => { if (writeInput) setWritingChar(writeInput); }}
                  disabled={!writeInput}
                  className="px-6 h-12 bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white rounded-lg font-bold transition-all"
                >
                  開始
                </button>
              </div>
              <div className="flex gap-2 flex-wrap justify-center max-w-md">
                {['你','好','我','大','小','中','人','天','學','是'].map(ch => (
                  <button
                    key={ch}
                    onClick={() => setWritingChar(ch)}
                    className="w-12 h-12 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xl rounded-lg border border-gray-200 transition-colors"
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          )
        )}
      </main>
    </div>
  );
};

export default App;
