import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, FullReadingResult } from '../../types';
import { parseReadingBenchmark, getBenchmarkFeedback, getSecBenchmarkFeedback, type ParsedBenchmark } from '../../utils/fluencyAnalyzer';
import DiffDisplay from '../ui/DiffDisplay';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useKaraoke } from '../../context/KaraokeContext';
import { useFullReadingSession, type SavedResult } from '../../hooks/useFullReadingSession';
import { useFullReadingTtsQueue } from '../../hooks/useFullReadingTtsQueue';
import { useFullReadingResultPersistence } from '../../hooks/useFullReadingResultPersistence';
import ReadingMetricsCard from './full-reading/ReadingMetricsCard';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import { useAuth } from '../../contexts/AuthContext';
import { splitZhuyinChars } from '../../utils/zhuyinUtils';
import { fontForZhuyin } from '../../constants/fonts';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import { groupIdxForProgress } from '../../utils/ttsHighlight';
import FluencyProgressChart, { type FullReadingAttempt } from './full-reading/FluencyProgressChart';
import SelfAssessment, { type AssessmentRating } from './full-reading/SelfAssessment';

/* ── Encouragement helper (same tier logic as ParagraphCard) ─────────────── */

const FULL_READING_TIERS: Array<{ min: number; stars: number; text: string; color: string }> = [
  { min: 0.90, stars: 5, text: '太厲害了！', color: 'text-emerald-600' },
  { min: 0.75, stars: 4, text: '唸得很流暢！', color: 'text-green-600' },
  { min: 0.60, stars: 3, text: '繼續練習！', color: 'text-green-600' },
  { min: 0,    stars: 2, text: '再多練幾次就會更熟～', color: 'text-amber-600' },
];

function getFullReadingEncouragement(matchRate: number): { stars: number; text: string; color: string } {
  const tier = FULL_READING_TIERS.find(t => matchRate >= t.min) ?? FULL_READING_TIERS[FULL_READING_TIERS.length - 1];
  return { stars: tier.stars, text: tier.text, color: tier.color };
}

/* ------------------------------------------------------------------ */

interface FullReadingProps {
  story: Story;
  onFinish: (result: FullReadingResult) => void;
  onBack: () => void;
  /** Session-level result rehydrated from DB (Bug #1320 — fallback when localStorage is cleared). */
  initialResult?: FullReadingResult | null;
  /** All reading attempts for this session from DB (Issue #1386 — 4-attempt progress chart). */
  fullReadingAttempts?: FullReadingAttempt[];
}

const FullReading: React.FC<FullReadingProps> = ({ story, onFinish, onBack, initialResult, fullReadingAttempts = [] }) => {
  const { token, user } = useAuth();
  const storageKey = scopedStepStorageKey('fullReading_progress_', story.id);
  // #1462: in toolbox mode, completion screen shows 重做/回工具箱 instead of 下一關.
  const inToolbox = isToolboxMode();

  /* ---- Persistence hook (localStorage + DB history) ---- */
  const {
    result, setResult,
    streamingTranscript, setStreamingTranscript,
    dedicatedHistory,
    historyRefreshKey, setHistoryRefreshKey,
  } = useFullReadingResultPersistence({
    storyId: story.id,
    token,
    userId: user?.id,
    storageKey,
    initialResult,
  });

  /* ---- Self-assessment for current attempt (Issue #1386) ---- */
  const [selfRating, setSelfRating] = useState<AssessmentRating | undefined>(undefined);
  const [showComparison, setShowComparison] = useState(false);

  /* ---- Parsed benchmark for progress chart (Issue #1386) ---- */
  const parsedBenchmark = useMemo<ParsedBenchmark[] | null>(() => {
    if (!story.readingBenchmark?.levels) return null;
    try {
      return parseReadingBenchmark(story.readingBenchmark.levels);
    } catch {
      return null;
    }
  }, [story.readingBenchmark]);

  /** Whether lesson uses seconds-based benchmark (G8 文言文) */
  const useSecUnit = useMemo(() => {
    if (!parsedBenchmark || parsedBenchmark.length === 0) return false;
    return 'unit' in parsedBenchmark[0] && (parsedBenchmark[0] as any).unit === 'sec';
  }, [parsedBenchmark]);

  /** AI-computed rating for the latest result */
  const aiRating = useMemo<AssessmentRating | undefined>(() => {
    if (!result || !parsedBenchmark || parsedBenchmark.length === 0) return undefined;
    let feedbackText: string | null = null;
    if (useSecUnit) {
      const durationSec = (result.durationMs || 0) / 1000;
      feedbackText = getSecBenchmarkFeedback(durationSec, parsedBenchmark);
    } else {
      feedbackText = getBenchmarkFeedback(result.cpm || 0, parsedBenchmark);
    }
    if (!feedbackText) return undefined;
    // Map benchmark feedback position to rating
    // parsedBenchmark[0] = lowest tier (slow/low), last = highest tier (fast/high)
    const idx = parsedBenchmark.findIndex(b => {
      if (useSecUnit && 'unit' in b) {
        const bs = b as any;
        const durationSec = (result.durationMs || 0) / 1000;
        return durationSec >= bs.minSec && durationSec <= bs.maxSec;
      } else if (!useSecUnit && !('unit' in b)) {
        const bc = b as any;
        return result.cpm >= bc.minCpm && result.cpm <= bc.maxCpm;
      }
      return false;
    });
    if (idx === -1) return undefined;
    const total = parsedBenchmark.length;
    if (total === 1) return 'mid';
    if (idx === 0) return useSecUnit ? 'high' : 'low'; // sec: fastest = high; cpm: slowest = low
    if (idx === total - 1) return useSecUnit ? 'low' : 'high'; // sec: slowest = low; cpm: fastest = high
    return 'mid';
  }, [result, parsedBenchmark, useSecUnit]);

  const { isZhuyinAny, processLinesSelective } = useZhuyin();
  const { karaokeEnabled } = useKaraoke();
  const vocabWords = useMemo(
    () => (story.vocabulary ?? []).map((v) => v.word).filter(Boolean),
    [story.vocabulary]
  );

  /* ---- Bug #1320 Bug 1: Auto-scroll to result area when result first appears ---- */
  const resultRef = useRef<HTMLDivElement | null>(null);
  const prevResultRef = useRef<SavedResult | null>(null);
  useEffect(() => {
    if (result && !prevResultRef.current && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevResultRef.current = result;
  }, [result]);

  const fullText = useMemo(() => story.content.join(''), [story.content]);

  /* ---- TTS queue hook (owns tts instance + paragraph queue) ---- */
  const {
    tts,
    currentTtsParagraph,
    speakingProgress,
    speakFullStory,
    stopTtsAll,
    isTtsPlaying,
  } = useFullReadingTtsQueue({ storyContent: story.content });

  /* ---- STT / recording hook ---- */
  const {
    isSessionActive,
    isPreparing,
    streamingTranscript: sessionTranscript,
    micError,
    startSession,
    submitReading,
    audioRecorder,
  } = useFullReadingSession({
    fullText,
    token,
    storyId: story.id,
    stopTtsAll,
    onResultReady: useCallback((newResult: SavedResult, transcript: string) => {
      setResult(newResult);
      setStreamingTranscript(transcript);
      setHistoryRefreshKey(k => k + 1);
    }, [setResult, setStreamingTranscript, setHistoryRefreshKey]),
  });

  const zhuyinLines = useMemo(
    () => processLinesSelective(story.content, vocabWords),
    [story.content, vocabWords, processLinesSelective]
  );

  /* ---- Render paragraph text with optional KTV TTS highlighting ---- */
  const renderParagraph = (line: string, idx: number) => {
    const zhuyinLine = zhuyinLines ? zhuyinLines[idx] : null;
    // KTV highlight: only when karaokeEnabled AND TTS is playing this paragraph
    const isTtsHighlighting = karaokeEnabled && isTtsPlaying && idx === currentTtsParagraph;

    if (isTtsHighlighting) {
      const displayText = (isZhuyinAny && typeof zhuyinLine === 'string') ? zhuyinLine : line;
      const chars = splitZhuyinChars(displayText);
      // groupIdxForProgress walks char groups so zhuyin PUA selectors (#1112)
      // and symbols stripped by _cleanForTts (#1110) don't push the split
      // past the real char boundary.
      const splitIdx = groupIdxForProgress(chars, speakingProgress);
      return (
        <>
          {speakingProgress > 0 && (
            <span className="text-accent font-bold">{chars.slice(0, splitIdx).join('')}</span>
          )}
          <span className={speakingProgress > 0 ? 'opacity-30' : 'opacity-90'}>
            {chars.slice(splitIdx).join('')}
          </span>
        </>
      );
    }

    // When karaoke is ON: finished TTS paragraphs stay fully colored
    if (karaokeEnabled && isTtsPlaying && currentTtsParagraph > idx) {
      return <span className="text-accent font-bold">{zhuyinLine ?? line}</span>;
    }

    return <>{zhuyinLine ?? line}</>;
  };

  const handleRetry = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch {}
    setResult(null);
    setStreamingTranscript('');
    audioRecorder.clearRecording();
    setSelfRating(undefined);
    setShowComparison(false);
  }, [storageKey, setResult, setStreamingTranscript, audioRecorder]);

  /* ================================================================ */
  /*  JSX                                                             */
  /* ================================================================ */

  return (
    <div
      className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative"
      style={{
        fontFamily: fontForZhuyin(isZhuyinAny),
      }}
    >
      {/* ── Single-column centered layout ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-48 custom-scrollbar">
        <div className="max-w-4xl mx-auto px-6 md:px-16 pt-4">

          {/* Full text card */}
          <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-10 mt-4">
            {/* Instructions */}
            {!result && !isSessionActive && !isPreparing && !isTtsPlaying && (
              <div className="mb-8 pb-6 border-b border-surface-container-high">
                <p className="text-lg font-headline font-bold text-on-surface leading-relaxed">
                  從頭到尾讀完整篇文章，不要中斷！
                </p>
                <p className="text-sm text-on-surface-variant mt-1">
                  標準比逐段朗讀寬鬆，放輕鬆自然地讀吧
                </p>
              </div>
            )}

            {/* Recording indicator */}
            {isSessionActive && (
              <div className="mb-6 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-headline font-bold text-emerald-700 uppercase tracking-wider">聆聽中</span>
              </div>
            )}

            {/* TTS playing indicator */}
            {isTtsPlaying && !isSessionActive && (
              <div className="mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-accent text-lg animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                <span className="text-sm font-headline font-bold text-accent uppercase tracking-wider">AI 朗讀中</span>
              </div>
            )}

            {/* Paragraphs */}
            <div className="space-y-10">
              {story.content.map((line, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <span className="text-xs font-headline font-bold text-on-surface-variant/40 pt-2 select-none shrink-0 w-6 text-right">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <p className={`text-xl md:text-2xl text-on-surface leading-[2rem] md:leading-[2.2rem] ${isZhuyinAny ? 'tracking-[0.15em]' : ''}`}>
                    {renderParagraph(line, idx)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Live transcript card */}
          {isSessionActive && sessionTranscript && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 mt-6">
              <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">即時辨識</p>
              <p className="text-lg text-on-surface leading-relaxed">{sessionTranscript}</p>
            </div>
          )}

          {isSessionActive && !sessionTranscript && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 mt-6">
              <p className="text-base text-on-surface-variant leading-relaxed">請開始朗讀上方課文…</p>
            </div>
          )}

          {/* ── Result section ──────────────────────────────────────── */}
          {result && (
            <div ref={resultRef} className="mt-6 space-y-6">
              {/* Encouragement — no numbers shown to student (Issues #1094, #1097) */}
              {(() => {
                const enc = getFullReadingEncouragement(result.matchRate);
                return (
                  <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 flex flex-col items-center gap-3">
                    <div className="flex gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className={`material-symbols-outlined text-3xl transition-colors ${
                            i < enc.stars ? 'text-amber-400' : 'text-on-surface-variant/20'
                          }`}
                          style={{ fontVariationSettings: i < enc.stars ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          star
                        </span>
                      ))}
                    </div>
                    <p className={`text-xl font-headline font-bold text-center ${enc.color}`}>
                      {enc.text}
                    </p>
                  </div>
                );
              })()}

              {/* Transcript */}
              {streamingTranscript && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">你說的</p>
                  <p className="text-base text-on-surface leading-relaxed line-clamp-6">{streamingTranscript}</p>
                </div>
              )}

              {/* Diff display */}
              {result.diffTokens && result.diffTokens.length > 0 && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">逐字比對</p>
                  <DiffDisplay tokens={result.diffTokens} showLegend className="text-lg" />
                </div>
              )}

              {/* Audio playback */}
              {audioRecorder.audioUrl && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">重聽錄音</p>
                  <audio src={audioRecorder.audioUrl} controls className="w-full h-10" aria-label="播放您的朗讀錄音" />
                </div>
              )}

              {/* 正確率 + 語速 metrics card (Issue #1505) */}
              <ReadingMetricsCard
                accuracy={Math.round(result.matchRate * 100)}
                cpm={result.cpm || 0}
                history={dedicatedHistory}
              />

              {/* ── Issue #1386: Self-assessment + 4-attempt progress chart ──
                  #1633: dedicatedHistory may not yet contain the in-flight
                  current attempt (save runs in parallel with the UI render),
                  so use max(history.length, 1) — first render after submit is
                  always 「第 1 次」 at minimum. */}
              <SelfAssessment
                onSelect={(rating) => {
                  setSelfRating(rating);
                  setShowComparison(true);
                }}
                selectedRating={selfRating}
                aiRating={aiRating}
                showComparison={showComparison}
                attemptNumber={Math.max(dedicatedHistory.length, 1)}
              />

              {fullReadingAttempts.length > 0 && (
                <FluencyProgressChart
                  attempts={fullReadingAttempts}
                  benchmark={parsedBenchmark}
                  unit={useSecUnit ? 'sec' : 'cpm'}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mic error */}
      {micError && (
        <div className="absolute bottom-52 left-1/2 -translate-x-1/2 px-5 py-2 bg-tertiary-container/20 rounded-full z-20">
          <span className="text-sm text-tertiary">{micError}</span>
        </div>
      )}

      {/* ── Fixed bottom CTA ──────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">

          {result ? (
            inToolbox ? (
              <ToolboxCompletionActions
                onRetry={handleRetry}
                className="w-full"
              />
            ) : (
              <>
                <button
                  onClick={handleRetry}
                  className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">refresh</span>
                  再讀一次
                </button>
                <button
                  onClick={() => {
                    try { localStorage.removeItem(storageKey); } catch {}
                    onFinish({
                      matchRate: result.matchRate,
                      feedback: result.feedback,
                      diffTokens: result.diffTokens,
                      transcript: streamingTranscript,
                      cpm: result.cpm,
                      durationMs: result.durationMs,
                      errorBreakdown: result.errorBreakdown,
                    });
                  }}
                  className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
                >
                  <span>下一關</span>
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </>
            )
          ) : isPreparing ? (
            <button disabled className="w-full h-14 rounded-full font-headline font-bold text-lg bg-surface-container-high text-on-surface-variant cursor-wait flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
              準備中...
            </button>
          ) : isSessionActive ? (
            <button
              onClick={submitReading}
              disabled={!sessionTranscript}
              className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                sessionTranscript
                  ? 'text-white shadow-[0_12px_48px_rgba(0,105,71,0.3)]'
                  : 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
              }`}
              style={sessionTranscript ? { background: 'linear-gradient(135deg, #006947, #34d399)' } : undefined}
            >
              <span className="material-symbols-outlined text-xl">check</span>
              完成朗讀
            </button>
          ) : isTtsPlaying ? (
            /* TTS playing — show pause/stop controls */
            <div className="w-full flex gap-3">
              <button
                onClick={tts.isTtsPaused ? tts.resumeTts : tts.pauseTts}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {tts.isTtsPaused ? 'play_arrow' : 'pause'}
                </span>
                {tts.isTtsPaused ? '繼續' : '暫停'}
              </button>
              <button
                onClick={stopTtsAll}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                停止
              </button>
            </div>
          ) : (
            /* Idle — AI朗讀 + 開始朗讀 side by side */
            <div className="w-full flex gap-3">
              <button
                onClick={speakFullStory}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                AI 朗讀
              </button>
              <button
                onClick={startSession}
                className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 animate-pulse"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
                開始朗讀
              </button>
            </div>
          )}
        </div>
      </div>

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

export default FullReading;
