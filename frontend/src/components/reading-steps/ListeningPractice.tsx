/**
 * ListeningPractice — Issue #251 / #764
 *
 * Three-phase listening comprehension exercise:
 *   Phase 1: Play story text via Azure TTS (zh-TW), paragraph by paragraph
 *   Phase 2: Student retells what they heard (voice or text input)
 *   Phase 3: Show AI evaluation with score and feedback
 *
 * #764: Changed from full-text single playback to paragraph-by-paragraph
 * playback. Each paragraph plays, then pauses — student presses "繼續" to
 * advance. Current paragraph is highlighted. Progress shown as "第 X/Y 段".
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Story } from '../../types';
import { evaluateListeningRetelling, ListeningEvaluateResponse } from '../../services/learningApi';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAuth } from '../../contexts/AuthContext';
import { speakText as cloudSpeakText, cancelTts } from '../../services/ttsApi';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ListeningResult {
  score: number;
  keyPointsCovered: string[];
  keyPointsMissed: string[];
  feedback: string;
}

interface ListeningPracticeProps {
  story: Story;
  onFinish: (result: ListeningResult) => void;
  onBack: () => void;
}

type Phase = 'play' | 'retell' | 'results';

/** Playback state for paragraph-by-paragraph mode */
type ParagraphPlayState =
  | 'idle'        // Not started yet
  | 'playing'     // Audio is playing
  | 'between'     // Paragraph finished, waiting for user to press Next
  | 'done';       // All paragraphs played

// ── TTS helpers ───────────────────────────────────────────────────────────────

/**
 * Speak a single paragraph using Azure TTS.
 * Returns a cancel function.
 */
function speakParagraph(
  text: string,
  onEnd: () => void,
  onError: (msg: string) => void,
): () => void {
  let cancelled = false;
  cloudSpeakText(text)
    .then(() => {
      if (!cancelled) onEnd();
    })
    .catch((err: Error) => {
      if (!cancelled) onError(err?.message ?? 'speech error');
    });

  return () => {
    cancelled = true;
    cancelTts();
  };
}

// ── Score colour helper ───────────────────────────────────────────────────────

function scoreColour(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-500';
}

function scoreLabel(score: number): string {
  if (score >= 90) return '非常優秀！';
  if (score >= 75) return '表現良好';
  if (score >= 60) return '尚可，繼續加油';
  if (score >= 45) return '需要多練習';
  return '請再聽一次試試看';
}

// ── Component ─────────────────────────────────────────────────────────────────

const ListeningPractice: React.FC<ListeningPracticeProps> = ({
  story,
  onFinish,
  onBack,
}) => {
  const { token } = useAuth();

  // Phase management
  const [phase, setPhase] = useState<Phase>('play');

  // Phase 1 — paragraph-by-paragraph playback
  const paragraphs = story.content; // string[]
  const [paragraphIdx, setParagraphIdx] = useState(0); // 0-based index of current paragraph
  const [playState, setPlayState] = useState<ParagraphPlayState>('idle');
  const [playRate, setPlayRate] = useState(0.85);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const cancelCurrentRef = useRef<(() => void) | null>(null);

  // Phase 2 — retelling
  const [retelling, setRetelling] = useState('');
  const [retellMode, setRetellMode] = useState<'text' | 'voice'>('text');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Phase 3 — results
  const [evalResult, setEvalResult] = useState<ListeningEvaluateResponse | null>(null);

  // Voice input for retelling
  const {
    status: speechStatus,
    transcript: speechTranscript,
    isSupported: speechSupported,
    errorMessage: speechError,
    startListening,
    stopListening,
    clearTranscript,
  } = useSpeechRecognition('zh-TW', (finalText) => {
    setRetelling((prev) => (prev ? prev + ' ' + finalText : finalText).trim());
  });

  // Sync interim speech transcript (kept for completeness)
  useEffect(() => {
    if (speechStatus === 'listening' && speechTranscript) {
      // Live interim shown separately below
    }
  }, [speechStatus, speechTranscript]);

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      cancelCurrentRef.current?.();
    };
  }, []);

  // Full text for AI evaluation (join all paragraphs)
  const fullText = paragraphs.join('\n');

  // ── Phase 1: Paragraph-by-paragraph playback ─────────────────────────────

  /** Start playing the paragraph at index `idx` */
  const playAtIndex = useCallback((idx: number) => {
    const text = paragraphs[idx];
    if (!text?.trim()) {
      // Empty paragraph — skip to next
      const next = idx + 1;
      if (next < paragraphs.length) {
        setParagraphIdx(next);
        setTimeout(() => playAtIndex(next), 50);
      } else {
        setPlayState('done');
      }
      return;
    }

    setTtsError(null);
    setPlayState('playing');

    const cancel = speakParagraph(
      text,
      () => {
        cancelCurrentRef.current = null;
        const isLast = idx >= paragraphs.length - 1;
        setPlayState(isLast ? 'done' : 'between');
      },
      (errMsg) => {
        cancelCurrentRef.current = null;
        setTtsError(`播放發生錯誤：${errMsg}`);
        setPlayState('idle');
      },
    );

    cancelCurrentRef.current = cancel;
  }, [paragraphs]);

  /** User presses "開始播放" (from idle or restart) */
  const handleStart = useCallback(() => {
    setParagraphIdx(0);
    playAtIndex(0);
  }, [playAtIndex]);

  /** User presses "繼續播放下一段" */
  const handleNextParagraph = useCallback(() => {
    const next = paragraphIdx + 1;
    if (next >= paragraphs.length) {
      setPlayState('done');
      return;
    }
    setParagraphIdx(next);
    playAtIndex(next);
  }, [paragraphIdx, paragraphs.length, playAtIndex]);

  /** User presses stop */
  const handleStop = useCallback(() => {
    cancelCurrentRef.current?.();
    cancelCurrentRef.current = null;
    setPlayState('idle');
  }, []);

  /** Replay from the beginning */
  const handleReplay = useCallback(() => {
    cancelCurrentRef.current?.();
    cancelCurrentRef.current = null;
    setParagraphIdx(0);
    setTimeout(() => playAtIndex(0), 100);
  }, [playAtIndex]);

  /** Replay current paragraph only */
  const handleReplayCurrent = useCallback(() => {
    cancelCurrentRef.current?.();
    cancelCurrentRef.current = null;
    playAtIndex(paragraphIdx);
  }, [paragraphIdx, playAtIndex]);

  const handleProceedToRetell = useCallback(() => {
    cancelCurrentRef.current?.();
    cancelCurrentRef.current = null;
    setPhase('retell');
  }, []);

  // ── Phase 2: Retelling ─────────────────────────────────────────────────────

  const handleVoiceToggle = useCallback(() => {
    if (speechStatus === 'listening') {
      stopListening();
    } else {
      clearTranscript();
      setRetellMode('voice');
      startListening();
    }
  }, [speechStatus, startListening, stopListening, clearTranscript]);

  const handleSubmitRetelling = useCallback(async () => {
    const trimmed = retelling.trim();
    if (!trimmed) {
      setSubmitError('請先說出或輸入你的覆述內容。');
      return;
    }
    if (!token) {
      setSubmitError('請先登入再提交。');
      return;
    }

    setSubmitError(null);
    setIsEvaluating(true);

    try {
      const result = await evaluateListeningRetelling(token, {
        storyTitle: story.title,
        originalText: fullText,
        studentRetelling: trimmed,
      });
      setEvalResult(result);
      setPhase('results');
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'AI 評估失敗，請稍後再試。',
      );
    } finally {
      setIsEvaluating(false);
    }
  }, [retelling, token, story.title, fullText]);

  // ── Phase 3: Results ───────────────────────────────────────────────────────

  const handleFinish = useCallback(() => {
    if (!evalResult) return;
    onFinish({
      score: evalResult.score,
      keyPointsCovered: evalResult.key_points_covered,
      keyPointsMissed: evalResult.key_points_missed,
      feedback: evalResult.feedback,
    });
  }, [evalResult, onFinish]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const totalParagraphs = paragraphs.length;
  const displayParagraph = paragraphIdx + 1; // 1-based for display
  const hasStarted = playState !== 'idle';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            cancelCurrentRef.current?.();
            onBack();
          }}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="返回上一步"
        >
          ← 返回
        </button>
        <h1 className="text-lg font-bold text-gray-900">聽力理解練習</h1>
        <div className="w-16" aria-hidden="true" />
      </div>

      {/* Progress indicators */}
      <div className="flex gap-2" role="group" aria-label="練習進度">
        {(['play', 'retell', 'results'] as Phase[]).map((p, i) => (
          <div
            key={p}
            className={`flex-1 h-1.5 rounded-full transition-colors ${
              phase === p
                ? 'bg-accent'
                : i < ['play', 'retell', 'results'].indexOf(phase)
                  ? 'bg-accent/40'
                  : 'bg-gray-200'
            }`}
            aria-label={
              p === 'play' ? '步驟一：聆聽' : p === 'retell' ? '步驟二：覆述' : '步驟三：結果'
            }
          />
        ))}
      </div>

      {/* ── Phase 1: Play ─────────────────────────────────────────────────── */}
      {phase === 'play' && (
        <div className="space-y-6">
          <div className="bg-blue-50 rounded-xl p-4 space-y-2">
            <h2 className="font-semibold text-blue-800 text-base">步驟一：仔細聆聽課文</h2>
            <p className="text-blue-700 text-sm">
              課文共 {totalParagraphs} 段，每段播完後可以按「繼續」消化內容，再聽下一段。
              聽完後你需要用自己的話說出課文的重點。
            </p>
          </div>

          {/* Speed control */}
          <div className="space-y-2">
            <label htmlFor="play-rate" className="text-sm font-medium text-gray-700">
              播放速度：{playRate === 0.7 ? '慢速' : playRate === 0.85 ? '標準' : '快速'}
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">慢</span>
              <input
                id="play-rate"
                type="range"
                min="0.7"
                max="1.1"
                step="0.2"
                value={playRate}
                onChange={(e) => {
                  setPlayRate(parseFloat(e.target.value));
                  if (playState === 'playing') {
                    handleStop();
                  }
                }}
                disabled={playState === 'playing'}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                aria-label="調整播放速度"
              />
              <span className="text-xs text-gray-500">快</span>
            </div>
          </div>

          {/* Paragraph list with highlights */}
          <div className="space-y-2" aria-label="課文段落">
            {paragraphs.map((para, idx) => {
              const isCurrent = idx === paragraphIdx && hasStarted;
              const isPast = hasStarted && idx < paragraphIdx;

              return (
                <div
                  key={idx}
                  className={`rounded-lg px-4 py-3 text-sm leading-relaxed transition-all duration-300 ${
                    isCurrent && playState === 'playing'
                      ? 'bg-accent/10 border border-accent text-gray-900 font-medium'
                      : isCurrent && playState === 'between'
                        ? 'bg-green-50 border border-green-300 text-gray-800'
                        : isPast
                          ? 'bg-gray-50 text-gray-400'
                          : 'bg-gray-50 text-gray-600'
                  }`}
                  aria-current={isCurrent ? 'true' : undefined}
                >
                  <span className="inline-block mr-2 text-xs font-semibold text-gray-400">
                    第 {idx + 1} 段
                  </span>
                  {para}
                  {isCurrent && playState === 'playing' && (
                    <span className="ml-2 inline-block text-accent animate-pulse text-xs">
                      ▶ 播放中
                    </span>
                  )}
                  {isCurrent && playState === 'between' && (
                    <span className="ml-2 inline-block text-green-600 text-xs">✓ 播完</span>
                  )}
                  {isPast && (
                    <span className="ml-2 inline-block text-gray-400 text-xs">✓</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Paragraph progress badge */}
          {hasStarted && (
            <div className="text-center">
              <span
                className="inline-block px-3 py-1 bg-gray-100 rounded-full text-sm font-medium text-gray-600"
                role="status"
                aria-live="polite"
              >
                第 {displayParagraph}/{totalParagraphs} 段
              </span>
            </div>
          )}

          {/* Playback controls */}
          <div className="flex flex-wrap gap-3 justify-center">
            {playState === 'idle' && (
              <button
                type="button"
                onClick={handleStart}
                className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                aria-label="開始播放課文"
              >
                <span aria-hidden="true">▶</span> 開始播放
              </button>
            )}

            {playState === 'playing' && (
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center gap-2 px-5 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2"
                aria-label="停止播放"
              >
                <span aria-hidden="true">⏸</span> 停止
              </button>
            )}

            {playState === 'between' && (
              <>
                <button
                  type="button"
                  onClick={handleNextParagraph}
                  className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label={`播放第 ${paragraphIdx + 2} 段`}
                >
                  <span aria-hidden="true">▶</span> 繼續播放下一段
                </button>
                <button
                  type="button"
                  onClick={handleReplayCurrent}
                  className="flex items-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  aria-label="重聽此段"
                >
                  <span aria-hidden="true">↺</span> 重聽此段
                </button>
              </>
            )}

            {playState === 'done' && (
              <button
                type="button"
                onClick={handleReplay}
                className="flex items-center gap-2 px-5 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                aria-label="從頭重新播放"
              >
                <span aria-hidden="true">↺</span> 從頭重聽
              </button>
            )}
          </div>

          {/* Status text */}
          <div className="text-center min-h-[1.25rem]" aria-live="polite" role="status">
            {playState === 'playing' && (
              <p className="text-sm text-accent animate-pulse">
                正在播放第 {displayParagraph} 段...
              </p>
            )}
            {playState === 'between' && paragraphIdx < totalParagraphs - 1 && (
              <p className="text-sm text-green-600 font-medium">
                第 {displayParagraph} 段播放完畢，準備好了再繼續
              </p>
            )}
            {playState === 'done' && (
              <p className="text-sm text-green-600 font-medium">
                全部 {totalParagraphs} 段播放完畢！可以重聽，或繼續下一步。
              </p>
            )}
          </div>

          {ttsError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
            >
              {ttsError}
            </div>
          )}

          {/* Proceed to retell — prominent once all done */}
          {playState === 'done' && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              我聽完了，開始覆述 →
            </button>
          )}

          {/* Allow skipping mid-play */}
          {(playState === 'playing' || playState === 'between') && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              跳過，直接覆述
            </button>
          )}

          {/* Allow skipping before playing for accessibility */}
          {playState === 'idle' && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              略過播放，直接覆述
            </button>
          )}
        </div>
      )}

      {/* ── Phase 2: Retell ───────────────────────────────────────────────── */}
      {phase === 'retell' && (
        <div className="space-y-6">
          <div className="bg-green-50 rounded-xl p-4 space-y-2">
            <h2 className="font-semibold text-green-800 text-base">步驟二：用自己的話覆述</h2>
            <p className="text-green-700 text-sm">
              試著說出你剛才聽到的課文重點。不需要一字不差，
              用自己的話表達你記得的內容就可以。
            </p>
          </div>

          {/* Input mode toggle */}
          <div
            className="flex rounded-lg overflow-hidden border border-gray-200"
            role="group"
            aria-label="輸入方式"
          >
            <button
              type="button"
              onClick={() => {
                if (speechStatus === 'listening') stopListening();
                setRetellMode('text');
              }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                retellMode === 'text'
                  ? 'bg-accent text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
              aria-pressed={retellMode === 'text'}
            >
              鍵盤輸入
            </button>
            <button
              type="button"
              onClick={() => setRetellMode('voice')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                retellMode === 'voice'
                  ? 'bg-accent text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!speechSupported}
              aria-pressed={retellMode === 'voice'}
              title={speechSupported ? undefined : '你的瀏覽器不支援語音輸入'}
            >
              語音輸入
            </button>
          </div>

          {/* Text input */}
          {retellMode === 'text' && (
            <div className="space-y-2">
              <label htmlFor="retelling-text" className="sr-only">
                輸入覆述內容
              </label>
              <textarea
                id="retelling-text"
                value={retelling}
                onChange={(e) => setRetelling(e.target.value)}
                placeholder="在這裡輸入你記得的課文內容..."
                rows={6}
                maxLength={2000}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 text-base placeholder-gray-400 resize-none focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                aria-label="覆述內容輸入框"
              />
              <p className="text-xs text-right text-gray-400">
                {retelling.length} / 2000
              </p>
            </div>
          )}

          {/* Voice input */}
          {retellMode === 'voice' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleVoiceToggle}
                  className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl shadow-lg transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 ${
                    speechStatus === 'listening'
                      ? 'bg-red-500 hover:bg-red-600 focus-visible:ring-red-400 animate-pulse'
                      : 'bg-accent hover:bg-accent-hover focus-visible:ring-accent'
                  }`}
                  aria-label={speechStatus === 'listening' ? '停止錄音' : '開始錄音'}
                >
                  {speechStatus === 'listening' ? '⏹' : '🎤'}
                </button>
              </div>

              <p
                className="text-center text-sm text-gray-600"
                role="status"
                aria-live="polite"
              >
                {speechStatus === 'listening'
                  ? '正在聆聽，說完後點擊停止...'
                  : speechStatus === 'error'
                    ? speechError
                    : '點擊麥克風開始說話'}
              </p>

              {/* Live transcript preview */}
              {speechStatus === 'listening' && speechTranscript && (
                <p className="text-sm text-gray-500 italic text-center px-4">
                  「{speechTranscript}」
                </p>
              )}

              {/* Accumulated retelling so far */}
              {retelling && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-medium text-gray-500">已記錄的覆述：</p>
                  <p className="text-sm text-gray-800 leading-relaxed">{retelling}</p>
                  <button
                    type="button"
                    onClick={() => setRetelling('')}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    清除重錄
                  </button>
                </div>
              )}
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
            >
              {submitError}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPhase('play')}
              className="px-4 py-3 border border-gray-200 text-gray-600 rounded-xl font-medium text-sm hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ← 重聽
            </button>
            <button
              type="button"
              onClick={handleSubmitRetelling}
              disabled={isEvaluating || !retelling.trim()}
              className="flex-1 py-3 bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              aria-busy={isEvaluating}
            >
              {isEvaluating ? '評估中...' : '提交覆述'}
            </button>
          </div>
        </div>
      )}

      {/* ── Phase 3: Results ──────────────────────────────────────────────── */}
      {phase === 'results' && evalResult && (
        <div className="space-y-6">
          {/* Score card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm space-y-2">
            <p className="text-sm text-gray-500 font-medium">聽力理解得分</p>
            <p
              className={`text-6xl font-black ${scoreColour(evalResult.score)}`}
              aria-label={`得分 ${Math.round(evalResult.score)} 分`}
            >
              {Math.round(evalResult.score)}
            </p>
            <p className={`text-lg font-semibold ${scoreColour(evalResult.score)}`}>
              {scoreLabel(evalResult.score)}
            </p>
          </div>

          {/* Feedback */}
          <div className="bg-amber-50 rounded-xl p-4 space-y-2">
            <h3 className="font-semibold text-amber-800 text-sm">老師的評語</h3>
            <p className="text-amber-900 text-sm leading-relaxed">{evalResult.feedback}</p>
          </div>

          {/* Key points covered */}
          {evalResult.key_points_covered.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-green-700 text-sm flex items-center gap-1">
                <span aria-hidden="true">✓</span> 你掌握到的重點
              </h3>
              <ul className="space-y-1" aria-label="掌握到的重點">
                {evalResult.key_points_covered.map((point, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-gray-700 bg-green-50 rounded-lg px-3 py-2"
                  >
                    <span className="text-green-500 mt-0.5 shrink-0" aria-hidden="true">✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key points missed */}
          {evalResult.key_points_missed.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-orange-600 text-sm flex items-center gap-1">
                <span aria-hidden="true">○</span> 可以補充的重點
              </h3>
              <ul className="space-y-1" aria-label="可以補充的重點">
                {evalResult.key_points_missed.map((point, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-gray-700 bg-orange-50 rounded-lg px-3 py-2"
                  >
                    <span className="text-orange-400 mt-0.5 shrink-0" aria-hidden="true">○</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Encouragement */}
          {evalResult.encouragement && (
            <div className="text-center py-2">
              <p className="text-sm text-gray-600 italic">{evalResult.encouragement}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setPhase('play');
                setRetelling('');
                setEvalResult(null);
                setPlayState('idle');
                setParagraphIdx(0);
              }}
              className="px-4 py-3 border border-gray-200 text-gray-600 rounded-xl font-medium text-sm hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              再練習一次
            </button>
            <button
              type="button"
              onClick={handleFinish}
              className="flex-1 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              完成練習 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListeningPractice;
