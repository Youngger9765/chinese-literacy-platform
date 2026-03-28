/**
 * ListeningPractice — Issue #251
 *
 * Three-phase listening comprehension exercise:
 *   Phase 1: Play story text via Cloud TTS Neural2 (zh-TW), Web Speech API fallback
 *   Phase 2: Student retells what they heard (voice or text input)
 *   Phase 3: Show AI evaluation with score and feedback
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
type PlayState = 'idle' | 'playing' | 'paused' | 'done';

// ── TTS helpers ───────────────────────────────────────────────────────────────

/**
 * Speak text using Cloud TTS Neural2 (zh-TW) with Web Speech API fallback.
 * Returns a speaker object with start/cancel interface matching prior API.
 */
function createSpeaker(text: string, rate: number): {
  start: (onEnd: () => void, onError: (e: string) => void) => void;
  cancel: () => void;
} {
  const start = (onEnd: () => void, onError: (e: string) => void) => {
    cloudSpeakText(text, rate)
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
  const speakerRef = useRef<ReturnType<typeof createSpeaker> | null>(null);

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

  // Full text to read aloud — join all paragraphs
  const fullText = story.content.join('\n');

  // ── Phase 1: Playback ──────────────────────────────────────────────────────

  const handlePlay = useCallback(() => {
    if (!isTTSSupported()) {
      setTtsError('你的瀏覽器不支援語音合成功能，請改用 Chrome。');
      return;
    }
    setTtsError(null);
    setPlayState('playing');

    const speaker = createSpeaker(fullText, playRate);
    speakerRef.current = speaker;

    speaker.start(
      () => setPlayState('done'),
      (errMsg) => {
        setTtsError(`播放發生錯誤：${errMsg}`);
        setPlayState('idle');
      },
    );
  }, [fullText, playRate]);

  const handlePause = useCallback(() => {
    // Cloud TTS uses <audio> element; pause via cancelTts and track state.
    // Web Speech API fallback also honours this via window.speechSynthesis.pause().
    cancelTts();
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
    }
    setPlayState('paused');
  }, []);

  const handleResume = useCallback(() => {
    // Re-trigger playback from beginning when resuming after pause
    // (HTML audio pause/resume position tracking is not exposed via ttsApi)
    if (window.speechSynthesis?.paused) {
      window.speechSynthesis.resume();
      setPlayState('playing');
    }
  }, []);

  const handleStop = useCallback(() => {
    speakerRef.current?.cancel();
    setPlayState('idle');
  }, []);

  const handleReplay = useCallback(() => {
    handleStop();
    // Brief delay to let SpeechSynthesis fully reset
    setTimeout(handlePlay, 100);
  }, [handleStop, handlePlay]);

  const handleProceedToRetell = useCallback(() => {
    speakerRef.current?.cancel();
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
                  if (playState === 'playing' || playState === 'paused') {
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

          {/* Playback controls */}
          <div className="flex flex-wrap gap-3 justify-center">
            {playState === 'idle' && (
              <button
                type="button"
                onClick={handlePlay}
                className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                aria-label="播放課文"
              >
                <span aria-hidden="true">▶</span> 播放課文
              </button>
            )}

            {playState === 'playing' && (
              <>
                <button
                  type="button"
                  onClick={handlePause}
                  className="flex items-center gap-2 px-5 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2"
                  aria-label="暫停播放"
                >
                  <span aria-hidden="true">⏸</span> 暫停
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-2 px-5 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  aria-label="停止播放"
                >
                  <span aria-hidden="true">⏹</span> 停止
                </button>
              </>
            )}

            {playState === 'paused' && (
              <>
                <button
                  type="button"
                  onClick={handleResume}
                  className="flex items-center gap-2 px-5 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  aria-label="繼續播放"
                >
                  <span aria-hidden="true">▶</span> 繼續
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-2 px-5 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  aria-label="停止播放"
                >
                  <span aria-hidden="true">⏹</span> 停止
                </button>
              </>
            )}

            {playState === 'done' && (
              <button
                type="button"
                onClick={handleReplay}
                className="flex items-center gap-2 px-5 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                aria-label="重新播放"
              >
                <span aria-hidden="true">↺</span> 重聽
              </button>
            )}
          </div>

          {/* Status text */}
          <div className="text-center">
            {playState === 'playing' && (
              <p className="text-sm text-accent animate-pulse" role="status" aria-live="polite">
                正在播放中...
              </p>
            )}
            {playState === 'paused' && (
              <p className="text-sm text-yellow-600" role="status">
                已暫停
              </p>
            )}
            {playState === 'done' && (
              <p className="text-sm text-green-600 font-medium" role="status">
                播放完畢！可以重聽，或繼續下一步。
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

          {/* Proceed button — available once playback started at least once */}
          {(playState === 'done' || playState === 'idle' && false) && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-base shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              我聽完了，開始覆述 →
            </button>
          )}

          {/* Allow skipping to retell even if not done playing */}
          {playState !== 'idle' && playState !== 'done' && (
            <button
              type="button"
              onClick={handleProceedToRetell}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              跳過，直接覆述
            </button>
          )}

          {/* Allow skipping even before playing for accessibility */}
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
