import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { formatTime } from '../../utils/formatTime';
import { Story, FullReadingResult } from '../../types';
import { parseReadingBenchmark, getAiFluencyInsight, type ParsedBenchmark } from '../../utils/fluencyAnalyzer';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useKaraoke } from '../../context/KaraokeContext';
import { useFullReadingSession, type SavedResult } from '../../hooks/useFullReadingSession';
import { useFullReadingTtsQueue } from '../../hooks/useFullReadingTtsQueue';
import { useFullReadingResultPersistence } from '../../hooks/useFullReadingResultPersistence';
import { getReadingAudioSignedUrl } from '../../services/learning/session';
import ReadingMetricsCard from './full-reading/ReadingMetricsCard';
import { EvalProgress } from './EvalProgress';
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
// Note: Web Speech removed (Issue #2266) — streaming transcript not available during recording.
// Live preview area will be empty until Gemini STT returns post-submission.

/* ------------------------------------------------------------------ */

interface FullReadingProps {
  story: Story;
  onFinish: (result: FullReadingResult) => void;
  onBack: () => void;
  /** Session-level result rehydrated from DB (Bug #1320 — fallback when localStorage is cleared). */
  initialResult?: FullReadingResult | null;
  /** All reading attempts for this session from DB (Issue #1386 — 4-attempt progress chart). */
  fullReadingAttempts?: FullReadingAttempt[];
  /** Full step_data['full-reading'] snapshot from DB (Issue #1549) — provides selfRating + transcript. */
  initialProgress?: FullReadingStepData;
  /** Persist incremental progress to LearningSession.step_progress (Issue #1549). */
  onProgressChange?: (stepData: FullReadingStepData, immediate?: boolean) => void;
  /** DB LearningSession integer id — used to bind uploaded audio to the attempt row (Issue #2266). */
  dbSessionId?: number | null;
}

const FullReading: React.FC<FullReadingProps> = ({
  story,
  onFinish,
  onBack,
  initialResult,
  fullReadingAttempts = [],
  initialProgress,
  onProgressChange,
  dbSessionId,
}) => {
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
    initialTranscript: initialProgress?.transcript,
  });

  /* ---- Self-assessment for current attempt (Issue #1386) ---- */
  // Issue #1549 — rehydrate selfRating from DB-loaded step_data when available.
  const [selfRating, setSelfRating] = useState<AssessmentRating | undefined>(
    () => (initialProgress?.self_rating as AssessmentRating | undefined) ?? undefined
  );
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

  /** AI-computed fluency insight for self-assessment comparison */
  const aiFluencyInsight = useMemo(() => {
    if (!result || !parsedBenchmark || parsedBenchmark.length === 0) return undefined;
    return getAiFluencyInsight(result.cpm || 0, result.durationMs || 0, parsedBenchmark) ?? undefined;
  }, [result, parsedBenchmark]);

  const aiRating = aiFluencyInsight?.rating;

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

  /* ---- 重點朗讀 (#2559): 有 keyReading.passage 就只朗讀老師 ☞ 指定的重點段，
   *      無則 fallback 唸全文 story.content。宣告在所有消費者(fullText/TTS/顯示)之前，避免 TDZ (#2279)。 ---- */
  const readingContent = useMemo(
    () => (story.keyReading?.passage ? [story.keyReading.passage] : story.content),
    [story.keyReading, story.content]
  );
  const fullText = useMemo(() => readingContent.join(''), [readingContent]);

  /* ---- TTS queue hook (owns tts instance + paragraph queue) ---- */
  const {
    tts,
    currentTtsParagraph,
    speakingProgress,
    speakFullStory,
    stopTtsAll,
    isTtsPlaying,
  } = useFullReadingTtsQueue({ storyContent: readingContent });

  /* ---- Issue #2503: persist the accepted take's attempt id so the recording can be
   *      replayed from GCS after the in-memory blob is gone (remount). ---- */
  const [audioAttemptId, setAudioAttemptId] = useState<number | undefined>(
    () => initialProgress?.audio_attempt_id
  );

  /* ---- STT / recording hook ---- */
  const {
    isSessionActive,
    isPreparing,
    isTranscribing,
    streamingTranscript: sessionTranscript,
    micError,
    fallbackReason,
    clearFallbackReason,
    startSession,
    stopSession,
    submitReading,
    audioRecorder,
  } = useFullReadingSession({
    fullText,
    token,
    storyId: story.id,
    dbSessionId: dbSessionId ?? null,
    stopTtsAll,
    onResultReady: useCallback((newResult: SavedResult, transcript: string) => {
      setResult(newResult);
      setStreamingTranscript(transcript);
      setHistoryRefreshKey(k => k + 1);
    }, [setResult, setStreamingTranscript, setHistoryRefreshKey]),
    onAudioSaved: useCallback((attemptId: number) => setAudioAttemptId(attemptId), []),
  });

  /* ---- Issue #2266: In-memory audio replay (same-session).
   *      Declared AFTER useFullReadingSession so `audioRecorder` exists when
   *      handleReplayAudio / its deps reference it — moving this above the hook
   *      caused a mount-time TDZ ReferenceError (#2289). */
  const [isPlayingReplay, setIsPlayingReplay] = useState(false);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const replayObjectUrlRef = useRef<string | null>(null);

  const handleReplayAudio = useCallback(() => {
    const blob = audioRecorder.audioBlob;
    if (!blob) return;

    // Clean up any existing replay
    if (replayAudioRef.current) {
      replayAudioRef.current.pause();
      replayAudioRef.current = null;
    }
    if (replayObjectUrlRef.current) {
      URL.revokeObjectURL(replayObjectUrlRef.current);
      replayObjectUrlRef.current = null;
    }

    const url = URL.createObjectURL(blob);
    replayObjectUrlRef.current = url;
    const audio = new Audio(url);
    replayAudioRef.current = audio;

    audio.onended = () => {
      setIsPlayingReplay(false);
      URL.revokeObjectURL(url);
      replayObjectUrlRef.current = null;
      replayAudioRef.current = null;
    };
    audio.onerror = () => setIsPlayingReplay(false);

    setIsPlayingReplay(true);
    audio.play().catch(() => setIsPlayingReplay(false));
  }, [audioRecorder.audioBlob]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      replayAudioRef.current?.pause();
      if (replayObjectUrlRef.current) {
        URL.revokeObjectURL(replayObjectUrlRef.current);
      }
    };
  }, []);

  // I3 (Issue #2156): liveTranscriptSegments / enhanceLiveTranscript removed.
  // Raw Web Speech gray-text preview replaces the punctuation-insertion path.
  // Reason: enhanceLiveTranscript ran on every STT partial → visible flicker.
  // Gemini provides accurate punctuation post-submission (no live re-insertion needed).

  /* ---- Issue #1549 — persist to step_progress (DB).
   *      We only push to DB after a result is committed; transcript and
   *      selfRating updates ride along so teachers see them too. The handler
   *      is debounced upstream (5 s) so rapid selfRating clicks don't spam. */
  useEffect(() => {
    if (!result || !onProgressChange) return;
    onProgressChange(
      {
        result: {
          matchRate: result.matchRate,
          feedback: result.feedback,
          diffTokens: result.diffTokens,
          cpm: result.cpm,
          durationMs: result.durationMs,
          errorBreakdown: result.errorBreakdown,
        },
        self_rating: selfRating,
        transcript: streamingTranscript,
        audio_attempt_id: audioAttemptId,
      },
      false,
    );
  }, [result, selfRating, streamingTranscript, audioAttemptId, onProgressChange]);

  /* ---- Issue #2503: replay recording from GCS when the in-memory blob is gone.
   *      After handleFinish + remount, audioRecorder has no blob but the audio was
   *      uploaded to GCS; fetch a short-lived signed URL via the persisted attempt id
   *      so 重聽錄音 stays available. ---- */
  const [persistedAudioUrl, setPersistedAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    if (audioRecorder.audioUrl) return;           // in-memory blob still available
    if (!result || !token || dbSessionId == null || audioAttemptId == null) return;
    let cancelled = false;
    getReadingAudioSignedUrl(dbSessionId, audioAttemptId, token)
      .then((url) => { if (!cancelled && url) setPersistedAudioUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [audioRecorder.audioUrl, result, token, dbSessionId, audioAttemptId]);

  const zhuyinLines = useMemo(
    () => processLinesSelective(readingContent, vocabWords),
    [readingContent, vocabWords, processLinesSelective]
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

  const handleCancel = useCallback(() => {
    stopSession();
    audioRecorder.clearRecording();
  }, [stopSession, audioRecorder]);

  const handleRetry = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch {}
    setResult(null);
    setStreamingTranscript('');
    audioRecorder.clearRecording();
    // Issue #2503 (review): clear the persisted audio pointer on retry so the next
    // take's 重聽錄音 can't fetch the PREVIOUS attempt's recording if this take's
    // upload callback hasn't landed yet (張冠李戴 race).
    setAudioAttemptId(undefined);
    setPersistedAudioUrl(null);
    setSelfRating(undefined);
    setShowComparison(false);
    clearFallbackReason();
  }, [storageKey, setResult, setStreamingTranscript, audioRecorder, clearFallbackReason]);

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

  /* ── Recording timer (Issue #2175) ──────────────────────────────────── */
  const [recordingSecs, setRecordingSecs] = useState(0);
  // 錄音長度（ms）保留到 transcribe 後 — recordingSecs 在 stop 時歸 0，故用 ref 留住
  // 給共用 <EvalProgress> 動態配評估進度節奏（#2396）。
  const lastRecordingMsRef = useRef(0);
  useEffect(() => {
    if (!isSessionActive) { setRecordingSecs(0); return; }
    lastRecordingMsRef.current = 0;
    const id = setInterval(() => setRecordingSecs(s => {
      const next = s + 1;
      lastRecordingMsRef.current = next * 1000;
      return next;
    }), 1000);
    return () => clearInterval(id);
  }, [isSessionActive]);

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
      {/* ── 評估進度：共用 EvalProgress（與逐段朗讀同款 duration 動態+緩動+snap，#2396）
            取代舊版乾轉圈 spinner（#2131）；置中 overlay 保留 ── */}
      {isTranscribing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-6">
          <div className="w-full max-w-md">
            <EvalProgress active={isTranscribing} recordingMs={lastRecordingMsRef.current} />
          </div>
        </div>
      )}

      {/* ── Single-column centered layout ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-48 custom-scrollbar">
        <div className={`mx-auto px-6 md:px-16 pt-4 ${result ? 'max-w-6xl' : 'max-w-4xl'}`}>

          {/* I4 (Issue #2156): Gemini fallback alert banner — 置於雙欄之上（全寬） */}
          {fallbackReason && result && (
            <div className="mt-6 flex items-start gap-3 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-300 shadow-sm">
              <span className="material-symbols-outlined text-amber-600 shrink-0 mt-0.5">warning</span>
              <div className="flex-1">
                <p className="text-base font-bold text-amber-800">高品質辨識暫時失敗，這是粗略結果</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  AI 音訊分析未能完成（{fallbackReason}），評分僅依瀏覽器語音辨識，準確度較低。建議重試以獲得精準評分。
                </p>
              </div>
              <button
                onClick={clearFallbackReason}
                className="text-amber-600 hover:text-amber-800 transition-colors shrink-0 mt-0.5"
                aria-label="關閉提示"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          )}

          {/* Issue #2502: 完成後左課文／右 AI 判斷雙欄；未完成時課文單欄，窄螢幕自動堆疊 */}
          <div className={result ? 'grid lg:grid-cols-2 gap-6 items-start' : ''}>

          {/* 左欄：Full text card（全文課文）*/}
          <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-10 mt-4">
            {/* Instructions */}
            {!result && !isSessionActive && !isPreparing && !isTtsPlaying && (
              <div className="mb-8 pb-6 border-b border-surface-container-high">
                <p className="text-lg font-headline font-bold text-on-surface leading-relaxed">
                  {story.keyReading?.passage
                    ? '朗讀老師指定的重點段落，不要中斷！'
                    : '從頭到尾讀完整篇文章，不要中斷！'}
                </p>
                <p className="text-sm text-on-surface-variant mt-1">
                  {story.keyReading?.passage
                    ? '練習流暢度，放輕鬆自然地讀吧'
                    : '標準比逐段朗讀寬鬆，放輕鬆自然地讀吧'}
                </p>
              </div>
            )}

            {/* TTS playing indicator */}
            {isTtsPlaying && !isSessionActive && (
              <div className="mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-accent text-lg animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                <span className="text-sm font-headline font-bold text-accent uppercase tracking-wider">AI 朗讀中</span>
              </div>
            )}

            {/* Paragraphs（重點朗讀時只顯示指定段 readingContent，#2559） */}
            <div className="space-y-10">
              {readingContent.map((line, idx) => (
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
          </div>{/* /左欄課文卡 */}

          {/* ── 右欄：AI 判斷結果（Issue #2502）──────────────────────── */}
          {result && (
            <div ref={resultRef} className="space-y-6 mt-4">
              {/* Stars + encouragement + transcript + audio (Issue #1960 — FullReadingScoreCard) */}
              <FullReadingScoreCard
                result={result}
                streamingTranscript={streamingTranscript}
                audioUrl={audioRecorder.audioUrl ?? persistedAudioUrl}
              />

              {/* 朗讀結果 (Issue #1960 — same style as LiveTutor ParagraphCard) */}
              <FullReadingFeedbackPanel
                diffTokens={result.diffTokens}
                targetText={fullText}
                paragraphs={readingContent}
              />

              {/* ── Issue #2266: In-memory audio replay button ──────────── */}
              {audioRecorder.audioBlob && (
                <div className="flex justify-center mt-2 mb-1">
                  <button
                    type="button"
                    onClick={handleReplayAudio}
                    disabled={isPlayingReplay}
                    className="flex items-center gap-2 px-4 py-2 rounded-full border border-accent/40 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="聽我的朗讀錄音"
                  >
                    <span>{isPlayingReplay ? '▶ 播放中…' : '▶ 聽錄音'}</span>
                  </button>
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
                aiInsight={aiFluencyInsight}
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
          </div>{/* /grid 左課文右判斷（Issue #2502）*/}
        </div>
      </div>

      {/* Mic error — Issue #2357: opaque banner, not transparent pill overlapping passage */}
      {micError && (
        <div className="mt-4 flex items-start gap-3 px-5 py-4 rounded-2xl bg-rose-50 border border-rose-300 shadow-sm">
          <span className="material-symbols-outlined text-rose-600 shrink-0 mt-0.5">mic_off</span>
          <div className="flex-1">
            <p className="text-base font-bold text-rose-800">{micError}</p>
          </div>
        </div>
      )}

      {/* Issue #2609: TTS Web Speech API fallback alert — must not be silent.
          Shown while AI 朗讀 falls back to the browser's built-in voice (Cloud
          TTS unreachable) so the student knows they're hearing a machine
          voice, not the real AI narration. Auto-clears once fallback
          playback ends or the next AI 朗讀 attempt succeeds.
          `absolute bottom-48` (not in-flow `mt-4`): FullReadingControls is a
          `fixed bottom-16` bar — on short passages (e.g. 重點朗讀 single
          paragraph) an in-flow banner lands directly underneath it and is
          fully invisible even though it's in the DOM (found via real-browser
          QA, not code-read). Anchoring above the fixed footer like the
          LiveTutor.tsx sibling banner does keeps it visible regardless of
          passage length. */}
      {tts.isTtsDegraded && (
        <div className="absolute bottom-48 left-1/2 -translate-x-1/2 z-30 w-[min(92%,520px)]">
          <div
            role="status"
            className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-300 shadow-md"
          >
            <span className="material-symbols-outlined text-amber-600 shrink-0 mt-0.5">warning</span>
            <div className="flex-1">
              <p className="text-base font-bold text-amber-800">現在念的是系統語音，不是 AI 朗讀</p>
              <p className="text-sm text-amber-700 mt-0.5">
                AI 朗讀暫時連不上，先用手機或電腦內建的語音幫你唸，聲音可能比較機械。等一下可以再按一次「AI 朗讀」試試看。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Fixed bottom CTA (Issue #1960 — FullReadingControls) ────── */}
      <FullReadingControls
        state={controlState}
        onSpeak={speakFullStory}
        onStartSession={startSession}
        onSubmit={submitReading}
        onCancel={handleCancel}
        onStopTts={stopTtsAll}
        onPauseTts={tts.pauseTts}
        onResumeTts={tts.resumeTts}
        onRetry={handleRetry}
        onFinish={handleFinish}
        isTtsPaused={tts.isTtsPaused}
        sessionTranscriptReady={!!sessionTranscript}
        inToolbox={inToolbox}
        recordingSecs={recordingSecs}
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
