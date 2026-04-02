/**
 * ListeningPractice — Issue #251 / #764
 *
 * Three-phase listening comprehension exercise:
 *   Phase 1: Play story text via Azure TTS (zh-TW), paragraph by paragraph
 *   Phase 2: Student retells what they heard (voice or text input)
 *   Phase 3: Show AI evaluation with score and feedback
 *
 * #764: Changed from full-text playback to paragraph-by-paragraph playback.
 *       After each paragraph, a "繼續下一段" button is shown.
 *       Current paragraph is highlighted in the text display.
 *       Within-paragraph sentence progress bar (from #763) is preserved.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Story } from '../../types';
import { evaluateListeningRetelling, ListeningEvaluateResponse } from '../../services/learningApi';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAuth } from '../../contexts/AuthContext';
import { speakTextWithProgress, cancelTts, TtsProgressInfo } from '../../services/ttsApi';

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
type PlayState = 'idle' | 'playing' | 'paused' | 'done';
/** 'between' = finished current paragraph, waiting for user to continue */
type ParagraphPlayState = 'idle' | 'playing' | 'between' | 'done';

// ── TTS helpers ───────────────────────────────────────────────────────────────

/**
 * Speak text using Azure TTS (zh-TW).
 * Returns a speaker object with start/cancel interface.
 */
function createSpeaker(text: string, _rate: number): {
  start: (
    onEnd: () => void,
    onError: (e: string) => void,
    onProgress: (info: TtsProgressInfo) => void,
  ) => void;
  cancel: () => void;
} {
  const start = (
    onEnd: () => void,
    onError: (e: string) => void,
    onProgress: (info: TtsProgressInfo) => void,
  ) => {
    speakTextWithProgress(text, onProgress)
      .then(onEnd)
      .catch((err: Error) => onError(err?.message ?? 'speech error'));
  };

  const cancel = () => {
    cancelTts();
  };

  return { start, cancel };
}

function isTTSSupported(): boolean {
  // Cloud TTS is available when backend is reachable; always return true
  // and let ttsApi handle fallback to Web Speech API gracefully.
  return true;
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

  // Phase 1 — playback
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [playRate, setPlayRate] = useState(0.85);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsProgress, setTtsProgress] = useState<TtsProgressInfo | null>(null);
  const speakerRef = useRef<ReturnType<typeof createSpeaker> | null>(null);

  // Paragraph state — #764
  const paragraphs = story.content; // string[], one entry per paragraph
  const [paragraphIdx, setParagraphIdx] = useState(0);
  const [paragraphPlayState, setParagraphPlayState] = useState<ParagraphPlayState>('idle');

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

  // Sync interim speech transcript to retelling textarea
  useEffect(() => {
    if (speechStatus === 'listening' && speechTranscript) {
      // Show interim results live (appended to existing text, trimmed)
    }
  }, [speechStatus, speechTranscript]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      speakerRef.current?.cancel();
    };
  }, []);

  // Full text to read aloud — join all paragraphs (used for retell evaluation)
  const fullText = story.content.join('\n');

  // ── Phase 1: Paragraph Playback ────────────────────────────────────────────

  /** Play the paragraph at the given index */
  const playParagraph = useCallback((idx: number) => {
    if (!isTTSSupported()) {
      setTtsError('你的瀏覽器不支援語音合成功能，請改用 Chrome。');
      return;
    }
    const text = paragraphs[idx];
    if (!text) return;

    setTtsError(null);
    setTtsProgress(null);
    setPlayState('playing');
    setParagraphPlayState('playing');

    const speaker = createSpeaker(text, playRate);
    speakerRef.current = speaker;

    speaker.start(
      () => {
        setPlayState('done');
        setTtsProgress(null);
        const isLast = idx >= paragraphs.length - 1;
        if (isLast) {
          setParagraphPlayState('done');
        } else {
          setParagraphPlayState('between');
        }
      },
      (errMsg) => {
        setTtsError(`播放發生錯誤：${errMsg}`);
        setPlayState('idle');
        setTtsProgress(null);
        setParagraphPlayState('idle');
      },
      (info) => setTtsProgress(info),
    );
  }, [paragraphs, playRate]);

  const handlePlay = useCallback(() => {
    playParagraph(paragraphIdx);
  }, [playParagraph, paragraphIdx]);

  const handleContinueNextParagraph = useCallback(() => {
    const nextIdx = paragraphIdx + 1;
    if (nextIdx >= paragraphs.length) {
      setParagraphPlayState('done');
      return;
    }
    setParagraphIdx(nextIdx);
    // Small delay to let React re-render before starting playback
    setTimeout(() => playParagraph(nextIdx), 50);
  }, [paragraphIdx, paragraphs.length, playParagraph]);

  const handlePause = useCallback(() => {
    cancelTts();
    setPlayState('paused');
    setTtsProgress(null);
    // Keep paragraphPlayState as-is so we know which paragraph we're on
  }, []);

  const handleResume = useCallback(() => {
    // Re-trigger playback from the beginning of the current paragraph
    playParagraph(paragraphIdx);
  }, [playParagraph, paragraphIdx]);

  const handleStop = useCallback(() => {
    speakerRef.current?.cancel();
    setPlayState('idle');
    setTtsProgress(null);
    setParagraphPlayState('idle');
    setParagraphIdx(0);
  }, []);

  const handleReplay = useCallback(() => {
    // Replay from beginning — reset to first paragraph
    speakerRef.current?.cancel();
    setParagraphIdx(0);
    setParagraphPlayState('idle');
    setPlayState('idle');
    setTtsProgress(null);
    setTimeout(() => playParagraph(0), 100);
  }, [playParagraph]);

  const handleProceedToRetell = useCallback(() => {
    speakerRef.current?.cancel();
    setPhase('retell');
  }, []);

  // Derived: overall play state for existing UI logic
  const isPlaying = playState === 'playing';
  const isPaused = playState === 'paused';
  const isIdle = playState === 'idle' && paragraphPlayState === 'idle';
  const isAllDone = paragraphPlayState === 'done';
  const isBetweenParagraphs = paragraphPlayState === 'between';

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            speakerRef.current?.cancel();
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
              點擊播放，認真聆聽「{story.title}」的內容。
              課文分為 {paragraphs.length} 段，每段播完後可以暫停消化再繼續。
              聽完後你需要用自己的話說出課文的重點。
            </p>
          </div>

          {/* Paragraph progress indicator */}
          {paragraphs.length > 1 && (
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="段落進度"
            >
              <span className="text-xs text-gray-500 whitespace-nowrap">
                第 {paragraphIdx + 1} / {paragraphs.length} 段
              </span>
              <div className="flex flex-1 gap-1">
                {paragraphs.map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-2 rounded-full transition-colors ${
                      i < paragraphIdx
                        ? 'bg-accent/60'
                        : i === paragraphIdx
                          ? isPlaying || isPaused
                            ? 'bg-accent'
                            : isBetweenParagraphs
                              ? 'bg-accent/60'
                              : 'bg-accent'
                          : 'bg-gray-200'
                    }`}
                    aria-label={`第 ${i + 1} 段${i < paragraphIdx ? '（已播完）' : i === paragraphIdx ? '（目前）' : ''}`}
                  />
                ))}
              </div>
            </div>
          )}

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
                  if (playState === 'playing' || playState === 'paused') {
                    handleStop();
                  }
                }}
                disabled={isPlaying}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                aria-label="調整播放速度"
              />
              <span className="text-xs text-gray-500">快</span>
            </div>
          </div>

          {/* Paragraph text display — highlights current paragraph */}
          <div className="space-y-2">
            {paragraphs.map((para, i) => (
              <p
                key={i}
                className={`text-sm leading-relaxed rounded-lg px-3 py-2 transition-colors ${
                  i === paragraphIdx && (isPlaying || isBetweenParagraphs || isPaused)
                    ? 'bg-blue-50 text-blue-900 font-medium border border-blue-200'
                    : i < paragraphIdx
                      ? 'text-gray-400'
                      : 'text-gray-700'
                }`}
                aria-current={i === paragraphIdx ? 'true' : undefined}
              >
                {para}
              </p>
            ))}
          </div>

          {/* Playback controls */}
          <div className="flex flex-wrap gap-3 justify-center">
            {isIdle && (
              <button
                type="button"
                onClick={handlePlay}
                className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-full font-semibold text-sm shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                aria-label="播放課文"
              >
                <span aria-hidden="true">▶</span> 播放課文
              </button>
            )}

            {isPlaying && (
              <>
                <button
                  type="button"
                  onClick={handlePause}
                  className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2"
                  aria-label="暫停播放"
                >
                  <span aria-hidden="true">⏸</span> 暫停
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  aria-label="停止播放"
                >
                  <span aria-hidden="true">⏹</span> 停止
                </button>
              </>
            )}

            {isPaused && (
              <>
                <button
                  type="button"
                  onClick={handleResume}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-full font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label="繼續播放"
                >
                  <span aria-hidden="true">▶</span> 繼續
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  aria-label="停止播放"
                >
                  <span aria-hidden="true">⏹</span> 停止
                </button>
              </>
            )}

            {/* Between paragraphs — show continue button */}
            {isBetweenParagraphs && (
              <>
                <button
                  type="button"
                  onClick={handleContinueNextParagraph}
                  className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-full font-semibold text-sm shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label={`繼續播放第 ${paragraphIdx + 2} 段`}
                >
                  <span aria-hidden="true">▶</span> 繼續下一段
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  aria-label="停止播放"
                >
                  <span aria-hidden="true">⏹</span> 停止
                </button>
              </>
            )}

            {isAllDone && (
              <button
                type="button"
                onClick={handleReplay}
                className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                aria-label="重新播放"
              >
                <span aria-hidden="true">↺</span> 重聽
              </button>
            )}
          </div>

          {/* TTS Progress bar — shown while playing (within-paragraph sentence progress from #763) */}
          {isPlaying && (
            <div className="space-y-2" aria-label="播放進度">
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={ttsProgress ? Math.round(ttsProgress.progress * 100) : 0}
                  aria-label="段落播放進度"
                >
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300 ease-linear"
                    style={{ width: `${ttsProgress ? ttsProgress.progress * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 tabular-nums min-w-[3rem] text-right">
                  {ttsProgress
                    ? `${ttsProgress.sentenceIndex + 1} / ${ttsProgress.totalSentences}`
                    : '— / —'}
                </span>
              </div>
              <p className="text-xs text-gray-400 text-center">
                第 {ttsProgress ? ttsProgress.sentenceIndex + 1 : '—'} 句，共 {ttsProgress ? ttsProgress.totalSentences : '—'} 句
              </p>
            </div>
          )}

          {/* Status text */}
          <div className="text-center">
            {isPlaying && (
              <p className="text-sm text-accent animate-pulse" role="status" aria-live="polite">
                正在播放第 {paragraphIdx + 1} 段...
              </p>
            )}
            {isPaused && (
              <p className="text-sm text-yellow-600" role="status">
                已暫停
              </p>
            )}
            {isBetweenParagraphs && (
              <p className="text-sm text-green-600 font-medium" role="status">
                第 {paragraphIdx + 1} 段播放完畢，準備好後點擊「繼續下一段」
              </p>
            )}
            {isAllDone && (
              <p className="text-sm text-green-600 font-medium" role="status">
                全部播放完畢！可以重聽，或繼續下一步。
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

          {/* Proceed button — available once all paragraphs done */}
          {isAllDone && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-full font-semibold text-sm shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              我聽完了，開始覆述 →
            </button>
          )}

          {/* Allow skipping to retell even if not done playing */}
          {(isPlaying || isPaused || isBetweenParagraphs) && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              跳過，直接覆述
            </button>
          )}

          {/* Allow skipping even before playing for accessibility */}
          {isIdle && (
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
              className="px-4 py-2.5 border border-gray-300 bg-transparent text-gray-600 rounded-full font-medium text-sm hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ← 重聽
            </button>
            <button
              type="button"
              onClick={handleSubmitRetelling}
              disabled={isEvaluating || !retelling.trim()}
              className="flex-1 py-2.5 bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white rounded-full font-semibold text-sm shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
                setParagraphPlayState('idle');
              }}
              className="px-4 py-2.5 border border-gray-300 bg-transparent text-gray-600 rounded-full font-medium text-sm hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              再練習一次
            </button>
            <button
              type="button"
              onClick={handleFinish}
              className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-full font-semibold text-sm shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
