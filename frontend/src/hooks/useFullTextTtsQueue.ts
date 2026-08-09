/**
 * useFullTextTtsQueue — whole-lesson sequential TTS playback for
 * FullTextAnnotate (讀全文-做記號).
 *
 * Owner ask (issue: 讀全文-做記號 audio player): a play control that can pause
 * and can stop, and — the part they cared about most — the reading should
 * track the text on screen as it plays. This hook owns the "walk every
 * paragraph in order, know which one is current, be provably stoppable" half
 * of that; FullTextAnnotate.tsx owns the scroll-into-view + highlight half by
 * reading `currentParagraphIdx`.
 *
 * Mirrors the paragraph-walk pattern proven in three prior fixes:
 *   - Intro.tsx (#2607/#2608): state + wasSpeakingRef transition-detection to
 *     advance the walk when a paragraph finishes on its own.
 *   - LessonAudioTable.tsx (#2627): passing the PARAGRAPH'S OWN INDEX to
 *     speakText(text, lessonId, idx) — not a hardcoded 0 — so each call hits
 *     the backend's per-paragraph canonical-sentence cache (GET
 *     /api/tts/mapping/{lessonId}) instead of paying a live 8-15s synthesis,
 *     AND so it isn't silently reading paragraph 0 no matter what plays.
 *   - LessonAudioTable.tsx (#2622): a component-owned "walk id" that every
 *     continuation must match before it's allowed to speak — proven on
 *     staging to close a real race (stop() flipped the UI to idle while
 *     currentTime kept advancing 13s → 18s → 41s) that neither utteranceRef
 *     nor ttsApi's module-level _currentAudio closed on their own.
 *
 * Does NOT modify useTtsPlayback.ts — only calls its existing public API
 * (speakText / pauseTts / resumeTts / stopTts + the state it publishes), the
 * same surface every other reading step already uses. See the hard boundary
 * noted in FullTextAnnotate.tsx for why.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTtsPlayback } from './useTtsPlayback';
import { prefetchText } from '../services/ttsApi';

interface UseFullTextTtsQueueProps {
  /** Whole-lesson paragraphs in on-screen order — story.content. Every entry
   *  IS story.content[idx], so (unlike Intro.tsx's teaser-text fallback) there
   *  is no case here where passing lessonId+idx would address the wrong text. */
  paragraphs: string[];
  /** Numeric lesson id for the backend's canonical-sentence cache. undefined
   *  (not NaN) when story.id isn't numeric — useTtsPlayback then takes the
   *  no-cache single-shot path per paragraph instead of a 422 against
   *  GET /api/tts/mapping/{lessonId} (an int path param). */
  lessonId: number | undefined;
}

export interface UseFullTextTtsQueueReturn {
  /** -1 = idle (nothing queued / not playing). */
  currentParagraphIdx: number;
  /** Audio is actually flowing right now (not paused, not still loading). */
  isPlaying: boolean;
  /** Fetch/synthesis in flight, no audio byte yet. */
  isLoading: boolean;
  isPaused: boolean;
  ttsError: string | null;
  isTtsDegraded: boolean;
  /** Starts a fresh walk from paragraph 0. No-op when paragraphs is empty. */
  play: () => void;
  pause: () => void;
  resume: () => void;
  /** Stops playback, invalidates the walk, resets currentParagraphIdx to -1. */
  stop: () => void;
}

export function useFullTextTtsQueue({
  paragraphs,
  lessonId,
}: UseFullTextTtsQueueProps): UseFullTextTtsQueueReturn {
  const [currentParagraphIdx, setCurrentParagraphIdx] = useState(-1);

  const tts = useTtsPlayback(() => {}, () => {});

  // Belt-and-suspenders stop — every <audio> element that has actually
  // started playing while this hook is mounted, tracked by patching
  // HTMLMediaElement.prototype.play. Mirrors the fix proven on staging for
  // LessonAudioTable (#2622): tts.stopTts() reaches the clip through
  // utteranceRef / ttsApi's module-level _currentAudio, and there is a
  // measured window where neither points at the element that is actually
  // sounding (e.g. a sentence fetch that was already in flight the instant
  // stop() ran). Tracking every element .play() was ever called on closes
  // that window without touching the shared hook every reading step uses.
  const startedAudioRef = useRef<Set<HTMLMediaElement>>(new Set());
  useEffect(() => {
    const started = startedAudioRef.current;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay(this: HTMLMediaElement, ...args) {
      started.add(this);
      return originalPlay.apply(this, args);
    };
    return () => {
      HTMLMediaElement.prototype.play = originalPlay;
      started.forEach((el) => { if (!el.paused) el.pause(); });
      started.clear();
    };
  }, []);

  // The walk id currently authorised to keep advancing. 0 = no active walk.
  // Every continuation (the auto-advance effect below) must be handed this
  // exact value at the moment it was scheduled; speakAt re-checks it against
  // the CURRENT value before ever calling tts.speakText. stop() sets this to
  // 0, so a stale "paragraph finished" callback that was already queued
  // before stop() ran can never resume the walk — same shape as
  // LessonAudioTable's activeRequestRef, which is what closed the 13s → 18s →
  // 41s race on staging (#2622). A simple boolean isn't enough: play() → stop()
  // → play() again needs the SECOND walk to also be distinguishable from the
  // first, not just "any active walk".
  const currentWalkIdRef = useRef(0);
  const nextWalkIdRef = useRef(1);

  // Read on every call so a play() that races a paragraphs prop update always
  // walks the latest array, without adding paragraphs to every callback's dep list.
  const paragraphsRef = useRef(paragraphs);
  paragraphsRef.current = paragraphs;

  const speakAt = useCallback((idx: number, walkId: number) => {
    if (walkId !== currentWalkIdRef.current) return; // superseded — stale continuation
    const list = paragraphsRef.current;
    if (idx >= list.length) {
      currentWalkIdRef.current = 0;
      setCurrentParagraphIdx(-1);
      return;
    }
    setCurrentParagraphIdx(idx);
    // Passing the paragraph's OWN index (not a hardcoded 0) is the #2627 fix —
    // this is what lets each call hit the backend's per-paragraph cache.
    tts.speakText(list[idx], lessonId, idx);
    // Warm the next paragraph while this one is being read. The in-loop
    // prefetch inside ttsApi only reaches the next *sentence* of the current
    // paragraph, so without this every paragraph boundary fetches cold and the
    // reading audibly stalls there (owner: 「段落之間的延遲太多了」).
    prefetchText(list[idx + 1], lessonId, idx + 1);
  }, [tts, lessonId]);

  const play = useCallback(() => {
    if (paragraphsRef.current.length === 0) return;
    const walkId = nextWalkIdRef.current++;
    currentWalkIdRef.current = walkId;
    speakAt(0, walkId);
  }, [speakAt]);

  const stop = useCallback(() => {
    currentWalkIdRef.current = 0; // invalidate — 0 never matches a real walkId
    tts.stopTts();
    // Belt and braces (see startedAudioRef comment above): pause every element
    // that has actually played while this hook was mounted, not just whatever
    // handle the hook/ttsApi currently thinks is live.
    startedAudioRef.current.forEach((el) => {
      if (!el.paused) { el.pause(); el.currentTime = 0; }
    });
    startedAudioRef.current.clear();
    setCurrentParagraphIdx(-1);
  }, [tts]);

  // Advance to the next paragraph once the current one finishes playing on
  // its own (isTtsSpeaking/isTtsLoading both fall back to false while a walk
  // is active). isTtsPaused deliberately does NOT flip isTtsSpeaking off (see
  // useTtsPlayback.pauseTts), so this never mistakes "paused" for "finished".
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const busy = tts.isTtsSpeaking || tts.isTtsLoading;
    const justFinished = wasBusyRef.current && !busy;
    wasBusyRef.current = busy;
    if (!justFinished) return;
    if (currentParagraphIdx < 0) return; // already stopped/reset — nothing to advance
    if (tts.ttsError) return; // a failed paragraph aborts the sequence, does not advance
    const walkId = currentWalkIdRef.current;
    if (!walkId) return; // no active walk
    speakAt(currentParagraphIdx + 1, walkId);
  }, [tts.isTtsSpeaking, tts.isTtsLoading, tts.ttsError, currentParagraphIdx, speakAt]);

  // A TTS error aborts the whole walk (handled above) but also must return
  // controls to idle even if the transition-detection effect above doesn't
  // fire this render (e.g. the error arrives while isTtsLoading was already
  // false a tick earlier) — mirrors Intro.tsx's separate ttsError-abort effect.
  useEffect(() => {
    if (tts.ttsError) {
      currentWalkIdRef.current = 0;
      setCurrentParagraphIdx(-1);
    }
  }, [tts.ttsError]);

  // Unmount safety: never leave audio playing after navigating away from the step.
  useEffect(() => {
    return () => { tts.stopTts(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    currentParagraphIdx,
    isPlaying: tts.isTtsSpeaking,
    isLoading: tts.isTtsLoading,
    isPaused: tts.isTtsPaused,
    ttsError: tts.ttsError,
    isTtsDegraded: tts.isTtsDegraded,
    play,
    pause: tts.pauseTts,
    resume: tts.resumeTts,
    stop,
  };
}
