import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, FullReadingResult } from '../../types';
import { parseReadingBenchmark, getBenchmarkFeedback, getSecBenchmarkFeedback, type ParsedBenchmark } from '../../utils/fluencyAnalyzer';
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
import { groupIdxForProgress } from '../../utils/ttsHighlight';
import FluencyProgressChart, { type FullReadingAttempt } from './full-reading/FluencyProgressChart';
import SelfAssessment, { type AssessmentRating } from './full-reading/SelfAssessment';
// Issue #1960: extracted sub-components
import FullReadingControls, { type ControlState } from './full-reading/FullReadingControls';
import FullReadingScoreCard from './full-reading/FullReadingScoreCard';
import FullReadingFeedbackPanel from './full-reading/FullReadingFeedbackPanel';
import { enhanceLiveTranscript } from '../../utils/liveTranscriptEnhance';
import type { TranscriptSegment } from '../../utils/liveTranscriptEnhance';

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
    isTranscribing,
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

  const handleFinish = useCallback(() => {
    if (!result) return;
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
  }, [result, storageKey, streamingTranscript, onFinish]);

  /* ── Derive control state for FullReadingControls ─────────────────── */
  const controlState: ControlState = result
    ? 'result'
    : isPreparing
    ? 'preparing'
    : isSessionActive
    ? 'recording'
    : isTtsPlaying
    ? 'ttsPlaying'
    : 'idle';

  // isTranscribing: Gemini audio analysis is in progress after user stops recording
  // Show a "分析中..." overlay so user knows something is happening (Issue #2131)

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
      {/* ── Gemini transcription loading overlay (Issue #2131) ─────────── */}
      {isTranscribing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-on-surface font-medium text-base">分析中…</p>
            <p className="text-on-surface-variant text-sm">AI 正在分析您的朗讀，請稍候</p>
          </div>
        </div>
      )}

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

          {/* Live transcript card — Issue #2147: enhanced with punctuation + homophone correction */}
          {isSessionActive && sessionTranscript && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 mt-6">
              <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">即時辨識</p>
              <p className="text-lg text-on-surface leading-relaxed">
                {(() => {
                  const { segments } = enhanceLiveTranscript(sessionTranscript, fullText);
                  return segments.map((seg: TranscriptSegment, i: number) => (
                    <span key={i} className={seg.kind === 'inserted' ? 'text-gray-400' : undefined}>
                      {seg.text}
                    </span>
                  ));
                })()}
              </p>
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
              {/* Stars + encouragement + transcript + audio (Issue #1960 — FullReadingScoreCard) */}
              <FullReadingScoreCard
                result={result}
                streamingTranscript={streamingTranscript}
                audioUrl={audioRecorder.audioUrl ?? null}
              />

              {/* 逐字比對 diff (Issue #1960 — FullReadingFeedbackPanel) */}
              <FullReadingFeedbackPanel diffTokens={result.diffTokens} />

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

      {/* ── Fixed bottom CTA (Issue #1960 — FullReadingControls) ────── */}
      <FullReadingControls
        state={controlState}
        onSpeak={speakFullStory}
        onStartSession={startSession}
        onSubmit={submitReading}
        onStopTts={stopTtsAll}
        onPauseTts={tts.pauseTts}
        onResumeTts={tts.resumeTts}
        onRetry={handleRetry}
        onFinish={handleFinish}
        isTtsPaused={tts.isTtsPaused}
        sessionTranscriptReady={!!sessionTranscript}
        inToolbox={inToolbox}
      />

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
