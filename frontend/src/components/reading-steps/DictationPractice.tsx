import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Story } from '../../types';
import { speakText as cloudSpeakText, cancelTts } from '../../services/ttsApi';

export interface DictationResult {
  totalWords: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  results: WordResult[];
}

interface WordResult {
  word: string;
  studentAnswer: string;
  isCorrect: boolean;
  skipped: boolean;
}

interface DictationPracticeProps {
  story: Story;
  onFinish: (result: DictationResult) => void;
  onBack: () => void;
}

type Phase = 'intro' | 'practice' | 'results';

/**
 * Extract vocabulary words from a story.
 * Prefers the story's vocabulary list; falls back to extracting individual
 * Chinese characters from the story content (up to 10).
 */
function extractDictationWords(story: Story): string[] {
  if (story.vocabulary && story.vocabulary.length > 0) {
    return story.vocabulary.map((v) => v.word).slice(0, 15);
  }

  // Fallback: extract unique Chinese characters from content
  const seen = new Set<string>();
  const chars: string[] = [];
  for (const line of story.content) {
    for (const ch of line) {
      if (/[\u4e00-\u9fa5]/.test(ch) && !seen.has(ch)) {
        seen.add(ch);
        chars.push(ch);
        if (chars.length >= 10) break;
      }
    }
    if (chars.length >= 10) break;
  }
  return chars;
}

/**
 * Speak text using Cloud TTS Neural2 (zh-TW) with Web Speech API fallback.
 * Returns a Promise that resolves when speech ends (or rejects on fatal error).
 */
function speakText(text: string, _rate = 0.85): Promise<void> {
  return cloudSpeakText(text, _rate);
}

// ---- Sub-components ----

const ProgressBar: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div
    role="progressbar"
    aria-valuenow={current}
    aria-valuemin={1}
    aria-valuemax={total}
    aria-label={`聽寫進度：第 ${current} 題，共 ${total} 題`}
    className="w-full bg-gray-200 rounded-full h-1.5 mb-4"
  >
    <div
      className="bg-accent h-1.5 rounded-full transition-all duration-500"
      style={{ width: `${(current / total) * 100}%` }}
    />
  </div>
);

const SpeakerIcon: React.FC<{ animate: boolean }> = ({ animate }) => (
  <svg
    className={`w-8 h-8 text-accent ${animate ? 'animate-pulse' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0 0l-3-3m3 3l3-3M6.343 9.657a8 8 0 000 4.686"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 9v6l-3-1.5V10.5L9 9z"
    />
  </svg>
);

// ---- Main component ----

const DictationPractice: React.FC<DictationPracticeProps> = ({ story, onFinish, onBack }) => {
  const words = React.useMemo(() => extractDictationWords(story), [story]);

  const [phase, setPhase] = useState<Phase>('intro');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [wordResults, setWordResults] = useState<WordResult[]>([]);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cloud TTS is always ready immediately; mark voicesLoaded true on mount.
  // Web Speech API voice loading is handled inside ttsApi fallback.
  useEffect(() => {
    setVoicesLoaded(true);
  }, []);

  // Focus input when entering practice phase or moving to next word
  useEffect(() => {
    if (phase === 'practice') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [phase, currentIndex]);

  const playCurrentWord = useCallback(async () => {
    if (!ttsSupported || isSpeaking) return;
    const word = words[currentIndex];
    if (!word) return;
    setIsSpeaking(true);
    try {
      await speakText(word);
    } catch {
      // TTS failed silently — student can use replay button
    } finally {
      setIsSpeaking(false);
    }
  }, [words, currentIndex, isSpeaking, ttsSupported]);

  // Auto-play when entering a new word
  useEffect(() => {
    if (phase === 'practice' && voicesLoaded) {
      playCurrentWord();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, voicesLoaded]);

  const handleStartPractice = () => {
    setPhase('practice');
    setCurrentIndex(0);
    setAnswer('');
    setWordResults([]);
  };

  const submitAnswer = useCallback(
    (skipped = false) => {
      const word = words[currentIndex];
      const trimmed = answer.trim();
      const isCorrect = !skipped && trimmed === word;

      const result: WordResult = {
        word,
        studentAnswer: skipped ? '' : trimmed,
        isCorrect,
        skipped,
      };

      const updatedResults = [...wordResults, result];
      setWordResults(updatedResults);

      if (currentIndex + 1 >= words.length) {
        // Done — show results
        cancelTts();
        const correct = updatedResults.filter((r) => r.isCorrect).length;
        const skippedCount = updatedResults.filter((r) => r.skipped).length;
        const incorrect = updatedResults.length - correct - skippedCount;
        onFinish({
          totalWords: words.length,
          correctCount: correct,
          incorrectCount: incorrect,
          skippedCount,
          results: updatedResults,
        });
        setPhase('results');
      } else {
        setCurrentIndex((i) => i + 1);
        setAnswer('');
      }
    },
    [words, currentIndex, answer, wordResults, onFinish],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submitAnswer();
  };

  // ---- Phase: intro ----
  if (phase === 'intro') {
    return (
      <div className="flex-1 flex flex-col bg-amber-50 overflow-hidden">
        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-8 max-w-lg mx-auto w-full">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">聽寫練習</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              系統會播放詞語的讀音，請聽完後在輸入框中寫出正確的字詞。
              <br />
              共 <span className="font-bold text-accent">{words.length}</span> 個詞語。
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-5 w-full space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">練習說明</p>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
                聆聽系統播放的詞語音頻
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
                在輸入框中輸入你聽到的詞語
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
                按「確認」或 Enter 提交答案
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">4</span>
                可以重播音頻，也可以選擇跳過
              </li>
            </ul>
          </div>

          {!ttsSupported && (
            <div className="bg-amber-100 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800 text-center">
              目前瀏覽器不支援語音播放，請嘗試使用 Chrome 或 Safari。
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="px-4 py-2.5 rounded-full text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            返回
          </button>
          <button
            onClick={handleStartPractice}
            className="px-6 py-2.5 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2"
          >
            開始聽寫
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ---- Phase: practice ----
  if (phase === 'practice') {
    const currentWord = words[currentIndex];
    const progressText = `${currentIndex + 1} / ${words.length}`;

    return (
      <div className="flex-1 flex flex-col bg-amber-50 overflow-hidden">
        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-6 max-w-lg mx-auto w-full">
          {/* Progress */}
          <div className="w-full">
            <ProgressBar current={currentIndex + 1} total={words.length} />
            <p className="text-xs text-gray-500 text-center">{progressText}</p>
          </div>

          {/* Speaker card */}
          <div className="bg-white rounded-3xl shadow-card p-8 w-full flex flex-col items-center gap-6">
            <p className="text-sm text-gray-500 font-medium">請聆聽並寫出詞語</p>

            {/* Speaker button */}
            <button
              onClick={playCurrentWord}
              disabled={isSpeaking || !ttsSupported}
              aria-label={isSpeaking ? '正在播放詞語音頻' : '播放詞語音頻'}
              aria-pressed={isSpeaking}
              className={`w-24 h-24 rounded-full flex flex-col items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
                ${isSpeaking
                  ? 'bg-accent/10 border-2 border-accent scale-110'
                  : 'bg-gray-50 border-2 border-gray-200 hover:border-accent hover:bg-accent/5 active:scale-95'
                }
              `}
            >
              <SpeakerIcon animate={isSpeaking} />
              <span className="text-xs text-gray-500">{isSpeaking ? '播放中...' : '點我播放'}</span>
            </button>

            {/* Answer input */}
            <div className="w-full space-y-3">
              <label htmlFor="dictation-answer-input" className="block text-xs text-gray-500 font-medium text-center">
                輸入你聽到的詞語
              </label>
              <input
                id="dictation-answer-input"
                ref={inputRef}
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="在此輸入..."
                aria-label="聽寫答案輸入框，輸入你聽到的詞語，按 Enter 提交"
                className="w-full text-center text-2xl font-bold py-4 px-4 rounded-xl border-2 border-gray-200 focus:border-accent focus:outline-none bg-white text-gray-900 placeholder-gray-300 transition-colors"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Character count hint */}
          {answer.length > 0 && (
            <p className="text-xs text-gray-400">
              已輸入 {answer.length} 個字
            </p>
          )}
        </div>

        {/* Bottom actions */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-3">
          <button
            onClick={() => submitAnswer(true)}
            className="px-4 py-2.5 rounded-full text-sm text-gray-500 hover:text-gray-700 border border-gray-300 bg-transparent hover:bg-gray-50 transition-colors"
          >
            跳過
          </button>
          <button
            onClick={() => submitAnswer(false)}
            disabled={!answer.trim()}
            className="flex-1 px-6 py-2.5 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover disabled:bg-gray-200 disabled:text-gray-400 text-white shadow-lg transition-all active:scale-95"
          >
            {currentIndex + 1 >= words.length ? '完成' : '下一題'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Phase: results (summary shown internally, then onFinish is called) ----
  // This phase is reached only momentarily; the parent navigates away via onFinish.
  // We show a brief "loading" state while onFinish fires.
  return (
    <div className="flex-1 flex items-center justify-center bg-amber-50">
      <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
};

export default DictationPractice;
