import { useState, useRef, useCallback } from 'react';
import { cancelTts, cleanForTts, pauseCurrentTts, resumeCurrentTts, speakTextWithProgress, TtsProgressInfo } from '../services/ttsApi';

/**
 * Manages TTS (Text-to-Speech) audio playback for LiveTutor.
 *
 * Responsibilities:
 *  - Cloud TTS fetch → <audio> element playback (primary)
 *  - Web Speech API fallback (when backend unavailable)
 *  - Cloud TTS: ontimeupdate-based cursor sync (audio.currentTime / audio.duration ratio)
 *  - Web Speech API fallback: rAF-based cursor animation (~4.2 chars/sec for Neural2 zh-TW)
 *  - isTtsSpeaking / isTtsPaused state
 *  - pause / resume / stop controls
 *
 * The utteranceRef and ttsRafRef are returned so the STT hook can null them
 * out before starting a new recording session.
 *
 * Fix (#1112, #1110): Cloud TTS path replaced rAF + wall-clock timing with
 * audio.ontimeupdate + currentTime/duration ratio, eliminating:
 *  1. onloadedmetadata vs onplay race (msPerChar stale at rAF start)
 *  2. wall-clock drift from buffering/mobile stalls
 * Web Speech API fallback path is unchanged.
 */
export function useTtsPlayback(
  onSpeakingProgress: (pos: number) => void,
  onRealtimeDiffTokensClear: () => void,
) {
  const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);
  const [isTtsPaused, setIsTtsPaused] = useState(false);
  /**
   * isTtsLoading — true from the moment speakText() is called until the first
   * audio byte starts playing (or until an error occurs).  UI should show a
   * spinner and disable the button during this window.
   */
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  /**
   * ttsError — non-null when the last TTS request failed and no fallback was
   * available.  UI should show a retry affordance.  Cleared automatically the
   * next time speakText() is called.
   */
  const [ttsError, setTtsError] = useState<string | null>(null);

  // Strong ref to TTS utterance — prevents Chrome GC bug where a local utterance
  // gets collected mid-playback, silencing onend/onboundary callbacks.
  const utteranceRef = useRef<SpeechSynthesisUtterance | HTMLAudioElement | null>(null);
  // True while the v2 sentence-level playback path is active — pause/resume
  // must talk to ttsApi._currentAudio via pauseCurrentTts/resumeCurrentTts,
  // because the internal Audio element is not exposed on utteranceRef.
  const v2PathActiveRef = useRef<boolean>(false);
  // rAF loop for Web Speech API fallback cursor animation (not used for Cloud TTS path)
  const ttsRafRef = useRef<number | null>(null);
  // Used only by Web Speech API fallback path
  const ttsStartTimeRef = useRef<number>(0);
  const ttsTotalCharsRef = useRef<number>(0);
  const msPerCharRef = useRef<number>(240); // default fallback for Web Speech path only
  const pausedElapsedRef = useRef<number>(0); // elapsed ms at pause time (Web Speech only)

  /**
   * Speak the given text via Cloud TTS (with Web Speech API fallback).
   *
   * When lessonId + paragraphIdx are provided, uses sentence-level sequential
   * playback via canonical v2 sentences (Issue #1208 fix: eliminates cache miss).
   * Otherwise falls back to single-shot full-paragraph synthesis.
   *
   * Cloud TTS path: drives cursor via audio.ontimeupdate + currentTime/duration ratio.
   * Web Speech fallback: drives cursor via rAF + wall-clock timing (unchanged).
   *
   * @param text - Text to synthesise.
   * @param lessonId - Optional lesson ID for canonical v2 sentence lookup.
   * @param paragraphIdx - Optional paragraph index (0-based) within the lesson.
   */
  const speakText = useCallback((text: string, lessonId?: number, paragraphIdx?: number) => {
    if (!text) return;
    cancelTts();
    setIsTtsPaused(false);
    setIsTtsLoading(true);
    setTtsError(null);
    // isTtsSpeaking stays false until audio actually starts playing —
    // during the loading window only isTtsLoading is true.

    // When lesson context is available, use sentence-level sequential playback
    // so SHA-256 keys match pre-generated GCS blobs (Issue #1208 fix).
    // Use speakTextWithProgress so onSpeakingProgress fires during playback
    // (fixes regression: highlight stopped updating when v2 path was introduced).
    if (lessonId !== undefined && paragraphIdx !== undefined) {
      const charCount = Array.from(cleanForTts(text)).length;
      v2PathActiveRef.current = true;
      utteranceRef.current = null;
      // v2 path: the first sentence starts playing very quickly; treat first
      // progress callback as the "playing" signal to flip loading → speaking.
      let v2PlaybackStarted = false;
      speakTextWithProgress(
        text,
        (info: TtsProgressInfo) => {
          if (!v2PlaybackStarted) {
            v2PlaybackStarted = true;
            setIsTtsLoading(false);
            setIsTtsSpeaking(true);
            onRealtimeDiffTokensClear();
            onSpeakingProgress(0);
          }
          const pos = Math.min(Math.floor(info.progress * charCount), charCount);
          onSpeakingProgress(pos);
        },
        lessonId,
        paragraphIdx,
      ).catch(() => {
        setTtsError('音檔載入失敗，請重試');
      }).finally(() => {
        v2PathActiveRef.current = false;
        setIsTtsLoading(false);
        setIsTtsSpeaking(false);
        setIsTtsPaused(false);
      });
      return;
    }

    v2PathActiveRef.current = false;

    // Lesson context not available — use original single-shot full-paragraph path.
    // Chrome requires speechSynthesis.speak() to be called within user-gesture context.
    // Since the Cloud TTS fetch is async, the gesture expires before .catch() runs.
    // Warm up speechSynthesis now (synchronously, in gesture) so the fallback works.
    if (window.speechSynthesis) {
      const warmup = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(warmup);
      window.speechSynthesis.cancel();
    }

    const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

    const stopTtsAnimation = () => {
      if (ttsRafRef.current !== null) {
        cancelAnimationFrame(ttsRafRef.current);
        ttsRafRef.current = null;
      }
    };

    const onSpeechEnd = () => {
      stopTtsAnimation();
      setIsTtsSpeaking(false);
      setIsTtsPaused(false);
      setIsTtsLoading(false);
    };

    const onSpeechError = () => {
      stopTtsAnimation();
      setIsTtsSpeaking(false);
      setIsTtsPaused(false);
      setIsTtsLoading(false);
      setTtsError('音檔載入失敗，請重試');
    };

    // Try Cloud TTS first via <audio> element for better control
    fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (blob.size === 0) throw new Error('Empty TTS audio');
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        utteranceRef.current = audio as unknown as SpeechSynthesisUtterance;

        // Use cleaned char count so cursor ceiling matches what TTS actually speaks.
        const charCount = Array.from(cleanForTts(text)).length;

        // ontimeupdate: sync highlight to actual audio position (ratio-based).
        // This eliminates both the onloadedmetadata vs onplay race and wall-clock drift.
        // NaN/Infinity guard: skip if duration not yet known or is zero.
        audio.ontimeupdate = () => {
          if (!isFinite(audio.duration) || audio.duration === 0) return;
          const ratio = audio.currentTime / audio.duration;
          const pos = Math.min(Math.floor(ratio * charCount), charCount);
          onSpeakingProgress(pos);
        };

        // onplay: flip loading → speaking as soon as first bytes play.
        audio.onplay = () => {
          setIsTtsLoading(false);
          setIsTtsSpeaking(true);
          onRealtimeDiffTokensClear();
          onSpeakingProgress(0);
        };

        audio.onended = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        audio.onerror = () => { URL.revokeObjectURL(url); onSpeechError(); };
        return audio.play();
      })
      .catch(() => {
        // Fallback: Web Speech API — rAF + wall-clock timing path (unchanged)
        msPerCharRef.current = 240; // reset to default estimate for Web Speech
        if (!window.speechSynthesis) { onSpeechError(); return; }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utteranceRef.current = utterance;
        utterance.lang = 'zh-TW';
        utterance.rate = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find(v => v.name.includes('Google') && v.name.includes('Taiwan')) ||
          voices.find(v => v.lang === 'zh-TW') ||
          voices.find(v => v.lang.startsWith('zh'));
        if (preferred) utterance.voice = preferred;

        const startCursorAnimation = () => {
          // Web Speech API started: flip loading → speaking
          setIsTtsLoading(false);
          setIsTtsSpeaking(true);
          onSpeakingProgress(0);
          onRealtimeDiffTokensClear();
          ttsStartTimeRef.current = performance.now();
          ttsTotalCharsRef.current = Array.from(text).length;
          const animate = () => {
            const elapsed = performance.now() - ttsStartTimeRef.current;
            const pos = Math.min(Math.floor(elapsed / msPerCharRef.current), ttsTotalCharsRef.current);
            onSpeakingProgress(pos);
            if (pos < ttsTotalCharsRef.current) {
              ttsRafRef.current = requestAnimationFrame(animate);
            }
          };
          ttsRafRef.current = requestAnimationFrame(animate);
        };

        utterance.onstart = startCursorAnimation;
        utterance.onboundary = (e) => { onSpeakingProgress(e.charIndex); };
        utterance.onend = onSpeechEnd;
        utterance.onerror = onSpeechError;

        const doSpeak = () => window.speechSynthesis.speak(utterance);
        if (window.speechSynthesis.getVoices().length === 0) {
          window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            doSpeak();
          };
        } else {
          doSpeak();
        }
      });
  }, [onSpeakingProgress, onRealtimeDiffTokensClear]);

  const pauseTts = () => {
    if (v2PathActiveRef.current) {
      // v2 sentence-level path: Audio element lives inside ttsApi, pause via helper.
      pauseCurrentTts();
      setIsTtsPaused(true);
      return;
    }
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      // Cloud TTS path: just pause. ontimeupdate stops firing automatically when paused.
      ua.pause();
    } else {
      // Web Speech API fallback path: pause synthesis + record elapsed for resume
      window.speechSynthesis?.pause();
      pausedElapsedRef.current = performance.now() - ttsStartTimeRef.current;
      if (ttsRafRef.current !== null) {
        cancelAnimationFrame(ttsRafRef.current);
        ttsRafRef.current = null;
      }
    }
    setIsTtsPaused(true);
  };

  const resumeTts = () => {
    if (v2PathActiveRef.current) {
      resumeCurrentTts();
      setIsTtsPaused(false);
      return;
    }
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      // Cloud TTS path: just resume. ontimeupdate was attached in speakText and
      // remains valid — it resumes naturally as audio.currentTime advances again.
      ua.play().catch(() => {});
    } else {
      // Web Speech API fallback path: reconstruct wall-clock start and restart rAF
      ttsStartTimeRef.current = performance.now() - pausedElapsedRef.current;
      window.speechSynthesis?.resume();
      const animate = () => {
        const elapsed = performance.now() - ttsStartTimeRef.current;
        const pos = Math.min(Math.floor(elapsed / msPerCharRef.current), ttsTotalCharsRef.current);
        onSpeakingProgress(pos);
        if (pos < ttsTotalCharsRef.current) {
          ttsRafRef.current = requestAnimationFrame(animate);
        }
      };
      ttsRafRef.current = requestAnimationFrame(animate);
    }
    setIsTtsPaused(false);
  };

  const stopTts = () => {
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      // Remove event listeners to prevent stale callbacks after stop
      ua.ontimeupdate = null;
      ua.onplay = null;
      ua.onended = null;
      ua.onerror = null;
      ua.pause();
      ua.currentTime = 0;
      // Revoke blob URL to prevent memory leak
      if (ua.src && ua.src.startsWith('blob:')) {
        URL.revokeObjectURL(ua.src);
      }
    } else if (ua) {
      // Web Speech API path: remove handlers before cancel
      const utt = ua as SpeechSynthesisUtterance;
      utt.onstart = null;
      utt.onend = null;
      utt.onerror = null;
      utt.onboundary = null;
    }
    // Stop Web Speech API (fallback path)
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    cancelTts();
    setIsTtsSpeaking(false);
    setIsTtsPaused(false);
    setIsTtsLoading(false);
    setTtsError(null);
  };

  return {
    isTtsSpeaking,
    isTtsPaused,
    isTtsLoading,
    ttsError,
    setIsTtsSpeaking,
    setIsTtsPaused,
    utteranceRef,
    ttsRafRef,
    speakText,
    pauseTts,
    resumeTts,
    stopTts,
  };
}
