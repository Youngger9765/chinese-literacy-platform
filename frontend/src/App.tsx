
import React, { useState } from 'react';
import { AppView, Story, ReadingAttempt, LearningSession, ComprehensionResult, VocabResult, FullReadingResult } from './types';
import StepperNav from './components/StepperNav';
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

  const handleSelectStory = (story: Story) => {
    setSelectedStory(story);
    setSession({
      storyId: story.id,
      startedAt: Date.now(),
      introCompleted: false,
      readingAttempt: null,
      comprehensionResult: null,
      vocabResult: null,
      fullReadingResult: null,
    });
    setView(AppView.INTRO);
  };

  const handleStartReading = () => {
    setSession(prev => prev ? { ...prev, introCompleted: true } : null);
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
        <StepperNav
          currentView={view}
          session={session}
          selectedStory={selectedStory}
          onNavigate={setView}
        />
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
