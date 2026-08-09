/**
 * useAssetAudio — play one pre-generated mp3 from the public /assets proxy.
 *
 * This is the anonymous half of 讀全文-做記號 playback (#2649). A student scans
 * a QR code off a paper worksheet, so there is no session, and the synthesis
 * endpoints answer 401 to anonymous callers by design — they cost money per
 * call and must not be reachable without a user. What *is* public is the
 * whole-lesson audio we generate ahead of time:
 *
 *   GET {API_BASE}/assets/demo-reading/{lessonId}/full.mp3   → 200 audio/mpeg
 *
 * (verified on staging 2026-08-10, together with a 404 on a lesson id that
 * doesn't exist, so a 200 there means the file is real rather than a proxy
 * that answers 200 to everything.)
 *
 * One file, so there are no paragraph boundaries and no scroll-following — the
 * signed-in path uses useFullTextTtsQueue for that.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function demoReadingUrl(lessonId: string | number, kind: 'full' | 'passage' = 'full'): string {
  return `${API_BASE}/assets/demo-reading/${lessonId}/${kind}.mp3`;
}

interface UseAssetAudioResult {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  /** True once the file has failed to load — callers hide the control. */
  hasError: boolean;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export function useAssetAudio(src: string): UseAssetAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Stop and release on unmount, and whenever the lesson changes. Without this
  // the audio keeps playing after navigation — the element is detached from the
  // tree but the browser keeps decoding it.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = '';
      }
      audioRef.current = null;
    };
  }, [src]);

  const play = useCallback(() => {
    setHasError(false);
    let el = audioRef.current;
    if (!el) {
      el = new Audio(src);
      el.preload = 'auto';
      el.addEventListener('ended', () => {
        setIsPlaying(false);
        setIsPaused(false);
      });
      el.addEventListener('error', () => {
        setHasError(true);
        setIsLoading(false);
        setIsPlaying(false);
        setIsPaused(false);
      });
      el.addEventListener('playing', () => setIsLoading(false));
      audioRef.current = el;
    }
    el.currentTime = 0;
    setIsLoading(true);
    setIsPaused(false);
    setIsPlaying(true);
    void el.play().catch(() => {
      setHasError(true);
      setIsLoading(false);
      setIsPlaying(false);
    });
  }, [src]);

  const pause = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setIsPaused(false);
    setIsPlaying(true);
    void el.play().catch(() => {
      setHasError(true);
      setIsPlaying(false);
    });
  }, []);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setIsPlaying(false);
    setIsPaused(false);
    setIsLoading(false);
  }, []);

  return { isPlaying, isPaused, isLoading, hasError, play, pause, resume, stop };
}
