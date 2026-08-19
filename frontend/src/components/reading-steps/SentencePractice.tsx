/**
 * SentencePractice — Issue #109, #927, #1203, #1883
 *
 * Refactored (#1883): state logic → useSentencePracticeState,
 * UI panels → SentenceInputCard, ExampleSentencesPanel, WordProgressSidebar.
 *
 * After stroke order practice, students compose 2 sentences using each
 * practiced vocabulary word. AI validates grammar and word usage.
 *
 * Persistence (#1203):
 * - localStorage key `sentencePractice_progress_${scope}` stores wordStates,
 *   completedWords, currentWordIndex so refreshing preserves progress.
 * - When caller passes `saveStepProgressPatch`, DB is synced with step_data
 *   (mid-exercise) and markCompleted (when every word is finished).
 */
import React, { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import NextStepFooter from '../learning/NextStepFooter';
import { useSentencePracticeState } from './useSentencePracticeState';
import SentenceInputCard from './SentenceInputCard';
import ExampleSentencesPanel from './ExampleSentencesPanel';
import WordProgressSidebar from './WordProgressSidebar';

// ── Props ─────────────────────────────────────────────────────────────────

interface SentencePracticeProps {
  practicedWords: string[];
  storyTitle: string;
  onFinish: () => void;
  onBack: () => void;
  inline?: boolean;
  /** Story id — used to scope localStorage key (#1203). */
  storyId?: string | number;
  /** Merge-based DB sync from LearningLayout (#1203). Optional — when absent,
   *  only localStorage persistence is active (good for /tools standalone). */
  saveStepProgressPatch?: (opts: {
    stepId: string;
    stepData: Record<string, unknown>;
    currentStep?: string | null;
    markCompleted?: boolean;
    immediate?: boolean;
  }) => void;
}

// ── Component ─────────────────────────────────────────────────────────────

const SentencePractice: React.FC<SentencePracticeProps> = ({
  practicedWords, storyTitle, onFinish, onBack, inline = false,
  storyId, saveStepProgressPatch,
}) => {
  const { token } = useAuth();
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;

  const {
    currentWordIndex,
    setCurrentWordIndex,
    wordStates,
    completedWords,
    currentWord,
    currentState,
    isCurrentDone,
    allWordsDone,
    pasteWarning,
    setPasteWarning,
    liveTranscripts,
    setLiveTranscripts,
    voiceStopRef0,
    voiceStopRef1,
    isComposingRef,
    loadExamples,
    updateSentenceText,
    handleValidate,
    handleKeyDown,
    handleCompleteCurrentWord,
    resetAll,
    storageKey,
  } = useSentencePracticeState({
    practicedWords,
    storyTitle,
    storyId,
    token,
    saveStepProgressPatch,
  });

  useEffect(() => { loadExamples(); }, [loadExamples]);

  const voiceStopRefs = [voiceStopRef0, voiceStopRef1] as const;

  const handlePasteWarning = () => {
    setPasteWarning(true);
    setTimeout(() => setPasteWarning(false), 3000);
  };

  const handleLiveTranscript = (idx: 0 | 1, text: string) => {
    setLiveTranscripts(prev => {
      const next: [string, string] = [prev[0], prev[1]];
      next[idx] = text;
      return next;
    });
  };

  // ── No words ──────────────────────────────────────────────────────
  if (practicedWords.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">edit_note</span>
          <p className="text-on-surface-variant">沒有需要造句練習的詞語</p>
          <NextStepFooter onNext={onFinish} label="繼續下一步" />
        </div>
      </div>
    );
  }

  // ── Word selector pills (for inline/mobile) ──────────────────────
  const wordPills = practicedWords.length > 1 && (
    <div className="flex flex-wrap gap-2 mb-4">
      {practicedWords.map((w, i) => {
        const done = completedWords.has(w);
        const active = i === currentWordIndex;
        return (
          <button
            key={w}
            onClick={() => setCurrentWordIndex(i)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-headline font-bold transition-all ${
              active
                ? 'bg-accent text-white shadow-sm'
                : done
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            {zh(w)}
            {done && <span className="material-symbols-outlined text-sm">check</span>}
          </button>
        );
      })}
    </div>
  );

  // ── Shared content renderer ───────────────────────────────────────
  function renderContent() {
    return (
      <div className="space-y-6">

        {/* Current word card */}
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 text-center">
          <p className="text-5xl font-bold text-accent leading-none mb-3">{zh(currentWord)}</p>
          <p className="text-sm text-on-surface-variant">
            用「{zh(currentWord)}」造兩個句子，讓 AI 幫你批改
          </p>
        </div>

        {/* Example sentences panel */}
        <ExampleSentencesPanel
          exampleSentences={currentState.exampleSentences}
          examplesLoading={currentState.examplesLoading}
          examplesError={currentState.examplesError}
          examplesSource={currentState.examplesSource}
          currentWord={currentWord}
          onRetry={loadExamples}
        />

        {/* Student sentence inputs */}
        {([0, 1] as const).map(idx => (
          <SentenceInputCard
            key={idx}
            idx={idx}
            entry={currentState.sentences[idx]}
            currentWord={currentWord}
            currentWordZhuyin={zh(currentWord)}
            isCurrentDone={isCurrentDone}
            liveTranscript={liveTranscripts[idx]}
            isComposingRef={isComposingRef}
            voiceStopRef={voiceStopRefs[idx]}
            onTextChange={updateSentenceText}
            onValidate={handleValidate}
            onKeyDown={handleKeyDown}
            onLiveTranscript={handleLiveTranscript}
            onPasteWarning={handlePasteWarning}
          />
        ))}

        {/* Paste warning */}
        {pasteWarning && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3 text-center animate-fade-in">
            <span className="text-sm text-amber-700 font-medium">請用自己的話造句，不要複製貼上喔！</span>
          </div>
        )}

        {/* Word complete — advance */}
        {currentState.allCorrect && !isCurrentDone && (
          <div className="bg-emerald-50 rounded-3xl p-6 text-center animate-fade-in">
            <span className="material-symbols-outlined text-3xl text-emerald-600 mb-2">celebration</span>
            <p className="text-lg font-headline font-bold text-emerald-700 mb-4">
              「{zh(currentWord)}」造句全部正確！
            </p>
            <button
              onClick={handleCompleteCurrentWord}
              className="h-12 px-8 rounded-full font-headline font-bold text-base text-white active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
            >
              {currentWordIndex < practicedWords.length - 1 ? '繼續下一個詞' : '完成所有造句'}
              <span className="material-symbols-outlined text-lg ml-1 align-middle">arrow_forward</span>
            </button>
          </div>
        )}

        {isCurrentDone && (
          <div className="bg-emerald-50 rounded-2xl px-5 py-3 text-center">
            <span className="text-sm font-medium text-emerald-700">
              <span className="material-symbols-outlined text-sm align-middle mr-1">check_circle</span>
              「{zh(currentWord)}」已完成
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Inline mode ───────────────────────────────────────────────────
  if (inline) {
    return <>{wordPills}{renderContent()}</>;
  }

  // ── Standalone mode — two-column: content left + word tabs right ──
  return (
    <div className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative">
      <div className="flex-1 min-h-0 px-4 md:px-8 py-6 md:py-8">
        <div className="w-full h-full flex gap-4">

          {/* Left: main content (scrollable, max-w-2xl centered) */}
          <div className="flex-1 min-w-0 overflow-y-auto pb-32 custom-scrollbar">
            <div className="max-w-2xl mx-auto w-full">
              {renderContent()}
            </div>
          </div>

          {/* Right: vertical word tab sidebar */}
          {practicedWords.length > 1 && (
            <div className="hidden md:block w-40 lg:w-48 shrink-0 overflow-y-auto custom-scrollbar">
              <WordProgressSidebar
                practicedWords={practicedWords}
                completedWords={completedWords}
                currentWordIndex={currentWordIndex}
                onSelectWord={setCurrentWordIndex}
                zhWord={zh}
              />
            </div>
          )}
        </div>

        {/* Mobile: horizontal pills (shown below top bar, above content) */}
        {practicedWords.length > 1 && (
          <div className="md:hidden absolute top-0 left-0 right-0 px-4 pt-4 pb-2 bg-surface z-10">
            {wordPills}
          </div>
        )}
      </div>

      {/* Fixed bottom CTA — only when all words done */}
      {allWordsDone && (
        <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto">
            {isToolboxMode() ? (
              <ToolboxCompletionActions
                onRetry={resetAll}
                className="w-full"
              />
            ) : (
              <NextStepFooter onNext={onFinish} label="繼續下一步" />
            )}
          </div>
        </div>
      )}

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b0ada6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #797770; }
      `}</style>
    </div>
  );
};

export default SentencePractice;
