import { useState, useRef, useCallback } from 'react';
import { cancelTts, cleanForTts } from '../services/ttsApi';

/**
 * Manages TTS (Text-to-Speech) audio playback for LiveTutor.
 *
 * Responsibilities:
 *  - Cloud TTS fetch → <audio> element playback (primary)
 *  - Web Speech API fallback (when backend unavailable)
 *  - rAF-based cursor animation (~4.2 chars/sec for Neural2 zh-TW)
 *  - isTtsSpeaking / isTtsPaused state
 *  - pause / resume / stop controls
 *
 * The utteranceRef and ttsRafRef are returned so the STT hook can null them
 * out before starting a new recording session.
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
  // rAF loop for TTS cursor animation
  const ttsRafRef = useRef<number | null>(null);
  const ttsStartTimeRef = useRef<number>(0);
  const ttsTotalCharsRef = useRef<number>(0);
  const msPerCharRef = useRef<number>(240); // default fallback, overridden by actual audio duration
  const pausedElapsedRef = useRef<number>(0); // elapsed ms at pause time

  /**
   * Speak the given text via Cloud TTS (with Web Speech API fallback).
   * Drives the cursor animation using time-based rAF (~4.2 chars/sec).
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

    const startCursorAnimation = () => {
      setIsTtsSpeaking(true);
      onSpeakingProgress(0);
      onRealtimeDiffTokensClear();
      ttsStartTimeRef.current = performance.now();
      // Use cleaned char count so the animation ceiling matches the audio's
      // actual char count (cleaned chars only, same as msPerChar basis).
      ttsTotalCharsRef.current = Array.from(cleanForTts(text)).length;
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

        // Issue #1112: Use timeupdate-based highlight sync instead of rAF timer.
        // This locks highlight position to the browser's actual playback cursor
        // regardless of provider speed (Azure 0.95x vs Gemini default).
        //
        // Strategy:
        //   1. onloadedmetadata — calibrate msPerChar from real audio.duration
        //      so the rAF fallback (pause/resume) still works correctly.
        //   2. ontimeupdate — primary sync: advance highlight based on
        //      currentTime / duration progress, which is provider-agnostic.
        //   3. startCursorAnimation — still called on onplay to set speaking state;
        //      the rAF loop runs but its position is overridden by ontimeupdate.
        const cleanedText = cleanForTts(text);
        const charCount = Array.from(cleanedText).length;

        audio.onloadedmetadata = () => {
          if (audio.duration > 0 && charCount > 0) {
            msPerCharRef.current = (audio.duration * 1000) / charCount;
            // Store total chars so rAF ceiling is correct for pause/resume path.
            ttsTotalCharsRef.current = charCount;
          }
        };

        // Primary sync: advance highlight proportionally to actual playback time.
        // Fires ~4× per second (browser-controlled), works for any audio speed.
        audio.ontimeupdate = () => {
          if (audio.duration > 0 && charCount > 0) {
            const progress = audio.currentTime / audio.duration;
            const pos = Math.min(Math.floor(progress * charCount), charCount);
            onSpeakingProgress(pos);
          }
        };

        audio.onplay = startCursorAnimation;
        audio.onended = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        audio.onerror = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        return audio.play();
      })
      .catch(() => {
        // Fallback: Web Speech API
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
    // Pause audio
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      ua.pause();
    } else {
      window.speechSynthesis?.pause();
    }
    // Pause cursor animation — record elapsed and cancel rAF
    pausedElapsedRef.current = performance.now() - ttsStartTimeRef.current;
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    setIsTtsPaused(true);
  };

  const resumeTts = () => {
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      // Detach onplay so it doesn't re-trigger startCursorAnimation (which resets progress to 0)
      ua.onplay = null;
      const audioElapsed = ua.currentTime * 1000;
      ttsStartTimeRef.current = performance.now() - audioElapsed;
      ua.play().catch(() => {});
    } else {
      ttsStartTimeRef.current = performance.now() - pausedElapsedRef.current;
      window.speechSynthesis?.resume();
    }
    // Restart cursor animation from current position
    const animate = () => {
      const elapsed = performance.now() - ttsStartTimeRef.current;
      const pos = Math.min(Math.floor(elapsed / msPerCharRef.current), ttsTotalCharsRef.current);
      onSpeakingProgress(pos);
      if (pos < ttsTotalCharsRef.current) {
        ttsRafRef.current = requestAnimationFrame(animate);
      }
    };
    ttsRafRef.current = requestAnimationFrame(animate);
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
