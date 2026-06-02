/**
 * useTTSEngine — TTS playback state machine (Issue #1956)
 *
 * Encapsulates all TTS state (play/pause/stop/paragraph navigation) that
 * previously lived inline in the ListeningPractice monolith.
 *
 * Returns:
 *  - Current play/paragraph state enums
 *  - Derived boolean flags (isPlaying, isPaused, isIdle, isAllDone, isBetweenParagraphs)
 *  - Action handlers: handlePlay, handlePause, handleResume, handleStop,
 *    handleContinueNext, handleReplay, handleProceedToRetell
 *  - TTS error / progress state
 *  - playRate + setPlayRate
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { TtsProgressInfo, cancelTts } from '../../../services/ttsApi';
import {
  PlayState,
  ParagraphPlayState,
  buildSpeaker,
  computePlayStateFlags,
  Speaker,
} from './listeningUtils';

export interface TTSEngineState {
  playState: PlayState;
  paragraphPlayState: ParagraphPlayState;
  paragraphIdx: number;
  playRate: number;
  ttsError: string | null;
  ttsProgress: TtsProgressInfo | null;
  isPlaying: boolean;
  isPaused: boolean;
  isIdle: boolean;
  isAllDone: boolean;
  isBetweenParagraphs: boolean;
  setPlayRate: (rate: number) => void;
  handlePlay: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleStop: () => void;
  handleContinueNext: () => void;
  handleReplay: () => void;
  handleProceedToRetell: () => void;
}

export function useTTSEngine(
  paragraphs: string[],
  onProceedToRetell: () => void,
): TTSEngineState {
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [playRate, setPlayRate] = useState(0.85);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsProgress, setTtsProgress] = useState<TtsProgressInfo | null>(null);
  const speakerRef = useRef<Speaker | null>(null);

  const [paragraphIdx, setParagraphIdx] = useState(0);
  const [paragraphPlayState, setParagraphPlayState] = useState<ParagraphPlayState>('idle');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      speakerRef.current?.cancel();
    };
  }, []);

  const playParagraph = useCallback(
    (idx: number) => {
      const text = paragraphs[idx];
      if (!text) return;
      setTtsError(null);
      setTtsProgress(null);
      setPlayState('playing');
      setParagraphPlayState('playing');
      const speaker = buildSpeaker(text, playRate);
      speakerRef.current = speaker;
      speaker.start(
        () => {
          setPlayState('done');
          setTtsProgress(null);
          if (idx >= paragraphs.length - 1) {
            setParagraphPlayState('done');
          } else {
            setParagraphPlayState('between');
          }
        },
        (errMsg) => {
          setTtsError(`播放發生錯誤：${errMsg}`);
          setPlayState('idle');
          setTtsProgress(null);
          setParagraphPlayState('idle');
        },
        (info) => setTtsProgress(info),
      );
    },
    [paragraphs, playRate],
  );

  const handlePlay = useCallback(() => playParagraph(paragraphIdx), [playParagraph, paragraphIdx]);

  const handleContinueNext = useCallback(() => {
    const next = paragraphIdx + 1;
    if (next >= paragraphs.length) {
      setParagraphPlayState('done');
      return;
    }
    setParagraphIdx(next);
    // Brief delay lets React commit the new paragraphIdx before TTS starts,
    // ensuring highlight state stays in sync with the playing paragraph.
    setTimeout(() => playParagraph(next), 50);
  }, [paragraphIdx, paragraphs.length, playParagraph]);

  const handlePause = useCallback(() => {
    cancelTts();
    setPlayState('paused');
    setTtsProgress(null);
  }, []);

  const handleResume = useCallback(() => playParagraph(paragraphIdx), [playParagraph, paragraphIdx]);

  const handleStop = useCallback(() => {
    speakerRef.current?.cancel();
    setPlayState('idle');
    setTtsProgress(null);
    setParagraphPlayState('idle');
    setParagraphIdx(0);
  }, []);

  const handleReplay = useCallback(() => {
    speakerRef.current?.cancel();
    setParagraphIdx(0);
    setParagraphPlayState('idle');
    setPlayState('idle');
    setTtsProgress(null);
    setTimeout(() => playParagraph(0), 100);
  }, [playParagraph]);

  const handleProceedToRetell = useCallback(() => {
    speakerRef.current?.cancel();
    onProceedToRetell();
  }, [onProceedToRetell]);

  const flags = computePlayStateFlags(playState, paragraphPlayState);

  return {
    playState,
    paragraphPlayState,
    paragraphIdx,
    playRate,
    ttsError,
    ttsProgress,
    ...flags,
    setPlayRate,
    handlePlay,
    handlePause,
    handleResume,
    handleStop,
    handleContinueNext,
    handleReplay,
    handleProceedToRetell,
  };
}
