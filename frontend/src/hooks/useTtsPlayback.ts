import { useState, useRef, useCallback } from 'react';
import { cancelTts } from '../services/ttsApi';

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

  /**
   * Speak the given text via Cloud TTS (with Web Speech API fallback).
   * Drives the cursor animation using time-based rAF (~4.2 chars/sec).
   */
  const speakText = useCallback((text: string) => {
    if (!text) return;
    cancelTts();
    setIsTtsPaused(false);

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
      ttsTotalCharsRef.current = Array.from(text).length;
      const MS_PER_CHAR = 240; // ~4.2 chars/sec — tuned for Neural2 zh-TW at rate 0.9
      const animate = () => {
        const elapsed = performance.now() - ttsStartTimeRef.current;
        const pos = Math.min(Math.floor(elapsed / MS_PER_CHAR), ttsTotalCharsRef.current);
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
        audio.onplay = startCursorAnimation;
        audio.onended = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        audio.onerror = () => { URL.revokeObjectURL(url); onSpeechEnd(); };
        return audio.play();
      })
      .catch(() => {
        // Fallback: Web Speech API
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
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      ua.pause();
    } else {
      window.speechSynthesis?.pause();
    }
    setIsTtsPaused(true);
  };

  const resumeTts = () => {
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      ua.play().catch(() => {});
    } else {
      window.speechSynthesis?.resume();
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
      (ua as HTMLAudioElement).currentTime = 0;
    }
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
