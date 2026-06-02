/**
 * useFullReadingTtsQueue — TTS paragraph-queue management for FullReading.
 *
 * Issue #1880: Extracted from FullReading.tsx to isolate TTS queueing logic.
 *
 * Owns the useTtsPlayback instance so that speakingProgress is wired correctly.
 *
 * Manages:
 *   - ttsQueueRef / ttsQueueIdxRef state
 *   - speakNextInQueue: sets currentTtsParagraph + calls tts.speakText
 *   - speakFullStory: initialises queue from story.content and starts
 *   - stopTtsAll: stops tts, clears queue, resets paragraph highlight
 *   - useEffect that advances the queue when a paragraph finishes playing
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTtsPlayback } from './useTtsPlayback';

interface UseFullReadingTtsQueueProps {
  storyContent: string[];
}

interface UseFullReadingTtsQueueReturn {
  /** The underlying tts instance — exposed so parent can access pause/resume/isTtsPaused */
  tts: ReturnType<typeof useTtsPlayback>;
  currentTtsParagraph: number;
  speakingProgress: number;
  speakFullStory: () => void;
  stopTtsAll: () => void;
  isTtsPlaying: boolean;
}

export function useFullReadingTtsQueue({
  storyContent,
}: UseFullReadingTtsQueueProps): UseFullReadingTtsQueueReturn {
  const [speakingProgress, setSpeakingProgress] = useState(0);
  const [currentTtsParagraph, setCurrentTtsParagraph] = useState(-1);

  // Own the TTS playback instance so setSpeakingProgress is properly wired.
  const tts = useTtsPlayback(setSpeakingProgress, () => {});

  const ttsQueueRef = useRef<string[]>([]);
  const ttsQueueIdxRef = useRef(0);

  const speakNextInQueue = useCallback(() => {
    const idx = ttsQueueIdxRef.current;
    const queue = ttsQueueRef.current;
    if (idx >= queue.length) {
      setCurrentTtsParagraph(-1);
      setSpeakingProgress(0);
      return;
    }
    setCurrentTtsParagraph(idx);
    setSpeakingProgress(0);
    tts.speakText(queue[idx]);
  }, [tts]);

  const speakFullStory = useCallback(() => {
    ttsQueueRef.current = [...storyContent];
    ttsQueueIdxRef.current = 0;
    speakNextInQueue();
  }, [storyContent, speakNextInQueue]);

  // When TTS finishes a paragraph, advance to next
  const prevTtsSpeaking = useRef(false);
  useEffect(() => {
    if (prevTtsSpeaking.current && !tts.isTtsSpeaking && currentTtsParagraph >= 0) {
      ttsQueueIdxRef.current += 1;
      speakNextInQueue();
    }
    prevTtsSpeaking.current = tts.isTtsSpeaking;
  }, [tts.isTtsSpeaking, currentTtsParagraph, speakNextInQueue]);

  const stopTtsAll = useCallback(() => {
    tts.stopTts();
    ttsQueueRef.current = [];
    ttsQueueIdxRef.current = 0;
    setCurrentTtsParagraph(-1);
    setSpeakingProgress(0);
  }, [tts]);

  const isTtsPlaying = tts.isTtsSpeaking || currentTtsParagraph >= 0;

  return {
    tts,
    currentTtsParagraph,
    speakingProgress,
    speakFullStory,
    stopTtsAll,
    isTtsPlaying,
  };
}
