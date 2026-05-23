/**
 * useFullReadingSession — STT/recording lifecycle for FullReading.
 *
 * Issue #1880: Extracted from FullReading.tsx to isolate STT complexity.
 *
 * Manages:
 *   - SpeechRecognition lifecycle (start/stop/restart on onend)
 *   - audioRecorder (for student playback review)
 *   - isPreparing / isSessionActive states
 *   - micError state
 *   - submitReading: double-click guard (#1632), analyzeFluency, saveReadingHistory
 *   - onResultReady callback: parent receives (result, cleanedTranscript) to update UI
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { cleanChineseText } from '../utils/textDiff';
import { analyzeFluency } from '../utils/fluencyAnalyzer';
import { DiffToken } from '../types';
import { useAudioRecorder } from './useAudioRecorder';
import { cancelTts } from '../services/ttsApi';
import { saveReadingHistory } from '../services/readingHistoryApi';

export interface SavedResult {
  matchRate: number;
  feedback: string;
  diffTokens: DiffToken[];
  cpm: number;
  durationMs: number;
  errorBreakdown: { correct: number; wrong: number; missing: number; extra: number };
}

interface UseFullReadingSessionProps {
  fullText: string;
  token: string | null;
  storyId: string | number;
  stopTtsAll: () => void;
  onResultReady: (result: SavedResult, transcript: string) => void;
}

interface UseFullReadingSessionReturn {
  isSessionActive: boolean;
  isPreparing: boolean;
  streamingTranscript: string;
  setStreamingTranscript: (v: string) => void;
  micError: string;
  startSession: () => void;
  stopSession: () => void;
  submitReading: () => void;
  audioRecorder: ReturnType<typeof useAudioRecorder>;
}

export function useFullReadingSession({
  fullText,
  token,
  storyId,
  stopTtsAll,
  onResultReady,
}: UseFullReadingSessionProps): UseFullReadingSessionReturn {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [streamingTranscript, setStreamingTranscript] = useState('');
  const [micError, setMicError] = useState('');

  const isSessionActiveRef       = useRef(false);
  const recognitionRef           = useRef<any>(null);
  const currentTranscriptRef     = useRef('');
  const accumulatedTranscriptRef = useRef('');
  const startTimeRef             = useRef<number>(0);

  const audioRecorder = useAudioRecorder(120);

  /* ---- Cleanup on unmount ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} }
      cancelTts();
    };
  }, []);

  /* ---- STT ---- */
  const startSession = useCallback(() => {
    if (isSessionActiveRef.current) return;
    stopTtsAll();
    setIsPreparing(true);
    setMicError('');

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('您的瀏覽器不支援語音辨識，請使用 Chrome 瀏覽器。');
      setIsPreparing(false); return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'cmn-Hant-TW';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsPreparing(false);
      if (!isSessionActiveRef.current) {
        startTimeRef.current = Date.now();
        isSessionActiveRef.current = true;
        setIsSessionActive(true);
      }
    };

    recognition.onresult = (event: any) => {
      let sessionTranscript = '';
      for (let i = 0; i < event.results.length; i++) sessionTranscript += event.results[i][0].transcript;
      const full = accumulatedTranscriptRef.current + sessionTranscript;
      currentTranscriptRef.current = full;
      setStreamingTranscript(cleanChineseText(full));
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setMicError('請允許麥克風權限後再試一次。');
        isSessionActiveRef.current = false; setIsSessionActive(false); setIsPreparing(false);
      } else if (event.error === 'audio-capture') {
        setMicError('找不到麥克風，請確認麥克風已連接後再試一次。');
        isSessionActiveRef.current = false; setIsSessionActive(false); setIsPreparing(false);
      }
    };

    recognition.onend = () => {
      if (isSessionActiveRef.current) {
        accumulatedTranscriptRef.current = currentTranscriptRef.current;
        try { recognition.start(); } catch (_) {}
      } else {
        setIsSessionActive(false); setIsPreparing(false); recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
    recognition.start();
    audioRecorder.startRecording().catch(() => {});
  }, [stopTtsAll, audioRecorder]);

  const stopSession = useCallback(() => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false); setIsPreparing(false);
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} recognitionRef.current = null; }
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
    audioRecorder.stopRecording();
  }, [audioRecorder]);

  /* ---- Submit & evaluate ---- */
  const submitReading = useCallback(() => {
    /* #1632 double-click guard: stopSession() flips this to false synchronously,
     * so a second click during the same tick exits before re-saving. */
    if (!isSessionActiveRef.current) return;
    const transcript = currentTranscriptRef.current;
    const durationMs = Date.now() - startTimeRef.current;
    stopSession();
    if (!transcript.trim()) { setMicError('未偵測到語音，請再試一次。'); return; }

    const fluency = analyzeFluency({
      spoken: cleanChineseText(transcript),
      target: fullText,
      durationMs,
    });

    const newResult: SavedResult = {
      matchRate: fluency.accuracy,
      feedback: fluency.feedback,
      diffTokens: fluency.diffTokens,
      cpm: fluency.cpm,
      durationMs: fluency.durationMs,
      errorBreakdown: fluency.errorBreakdown,
    };

    onResultReady(newResult, cleanChineseText(transcript));

    /* #1632: persist this attempt to reading_history HERE — fired by the actual
     * completion event, so re-mounts (page revisit) won't add fake rows. */
    const durationSec = fluency.durationMs / 1000;
    if (token && durationSec > 0) {
      saveReadingHistory(
        {
          lesson_id: String(storyId),
          reading_type: 'full',
          cpm: fluency.cpm || 0,
          accuracy: Math.round((fluency.accuracy || 0) * 100),
          duration_seconds: durationSec,
        },
        token,
      ).catch((err) => console.error('Failed to save reading history:', err));
    }
  }, [fullText, stopSession, token, storyId, onResultReady]);

  return {
    isSessionActive,
    isPreparing,
    streamingTranscript,
    setStreamingTranscript,
    micError,
    startSession,
    stopSession,
    submitReading,
    audioRecorder,
  };
}
