/**
 * listeningUtils.ts — Pure helpers extracted from ListeningPractice (Issue #1956)
 *
 * No React imports — fully unit-testable.
 */

import { speakTextWithProgress, cancelTts, TtsProgressInfo } from '../../../services/ttsApi';

export type PlayState = 'idle' | 'playing' | 'paused' | 'done';
export type ParagraphPlayState = 'idle' | 'playing' | 'between' | 'done';

export interface PlayStateFlags {
  isPlaying: boolean;
  isPaused: boolean;
  isIdle: boolean;
  isAllDone: boolean;
  isBetweenParagraphs: boolean;
}

export interface Speaker {
  start: (
    onEnd: () => void,
    onError: (msg: string) => void,
    onProgress: (info: TtsProgressInfo) => void,
  ) => void;
  cancel: () => void;
}

/**
 * Returns the Tailwind text-color class corresponding to a listening score.
 * Mirrors the original scoreColour() inline function in ListeningPractice.tsx.
 */
export function scoreColour(score: number): string {
  if (score >= 80) return 'text-emerald-700';
  if (score >= 60) return 'text-amber-700';
  return 'text-tertiary';
}

/**
 * Creates a Speaker object that wraps speakTextWithProgress + cancelTts.
 * The `_rate` parameter is accepted for API symmetry but TTS rate is controlled
 * server-side via the TTS service configuration.
 */
export function buildSpeaker(text: string, _rate: number): Speaker {
  const start = (
    onEnd: () => void,
    onError: (msg: string) => void,
    onProgress: (info: TtsProgressInfo) => void,
  ) => {
    speakTextWithProgress(text, onProgress)
      .then(onEnd)
      .catch((err: Error) => onError(err?.message ?? 'speech error'));
  };
  return { start, cancel: () => cancelTts() };
}

/**
 * Derives boolean UI-state flags from the raw playState + paragraphPlayState enums.
 * Extracted so the main component and unit tests share a single source of truth.
 */
export function computePlayStateFlags(
  playState: PlayState,
  paragraphPlayState: ParagraphPlayState,
): PlayStateFlags {
  return {
    isPlaying: playState === 'playing',
    isPaused: playState === 'paused',
    isIdle: playState === 'idle' && paragraphPlayState === 'idle',
    isAllDone: paragraphPlayState === 'done',
    isBetweenParagraphs: paragraphPlayState === 'between',
  };
}
