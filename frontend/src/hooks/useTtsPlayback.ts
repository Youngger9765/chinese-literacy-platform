import { useState, useRef, useCallback } from 'react';
import { cancelTts, cleanForTts } from '../services/ttsApi';

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

  // Strong ref to TTS utterance — prevents Chrome GC bug where a local utterance
  // gets collected mid-playback, silencing onend/onboundary callbacks.
  const utteranceRef = useRef<SpeechSynthesisUtterance | HTMLAudioElement | null>(null);
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
   * Cloud TTS path: drives cursor via audio.ontimeupdate + currentTime/duration ratio.
   * Web Speech fallback: drives cursor via rAF + wall-clock timing (unchanged).
   */
  const speakText = useCallback((text: string) => {
    if (!text) return;
    cancelTts();
    setIsTtsPaused(false);

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

        // onplay: only sets speaking state + resets progress to 0. No rAF started here.
        audio.onplay = () => {
          setIsTtsSpeaking(true);
          onRealtimeDiffTokensClear();
          onSpeakingProgress(0);
        };

        audio.onended = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        audio.onerror = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        return audio.play();
      })
      .catch(() => {
        // Fallback: Web Speech API — rAF + wall-clock timing path (unchanged)
        msPerCharRef.current = 240; // reset to default estimate for Web Speech
        if (!window.speechSynthesis) { onSpeechEnd(); return; }
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
        utterance.onerror = onSpeechEnd;

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
      ua.pause();
      ua.currentTime = 0;
    }
    // Stop Web Speech API (fallback path)
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    cancelTts();
    setIsTtsSpeaking(false);
    setIsTtsPaused(false);
  };

  return {
    isTtsSpeaking,
    isTtsPaused,
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
