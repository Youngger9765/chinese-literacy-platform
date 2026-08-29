import { useState, useRef, useCallback, useEffect } from 'react';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';

export interface AudioRecorderState {
  status: RecorderStatus;
  audioUrl: string | null;
  audioBlob: Blob | null;
  errorMessage: string;
  elapsedSeconds: number;
  remainingSeconds: number;
  volumeLevel: number;
  /**
   * Issue #2497 — true when the *last* recording session was auto-stopped because
   * it hit `maxDurationSeconds`.  Consumers use this to warn the student that the
   * recording may be incomplete (previously the cut-off was silent → the tail of a
   * long reading was transcribed as nothing and scored as 漏念).
   * Reset to false on startRecording().
   */
  reachedMaxDuration: boolean;
}

export interface AudioRecorderActions {
  /** Resolves null when recording started; otherwise a user-facing error message. */
  startRecording: () => Promise<string | null>;
  stopRecording: () => void;
  /**
   * Stop recording and wait for the MediaRecorder onstop event to fire,
   * then return the final Blob.  Resolves to null if not recording or on error.
   *
   * This is the CORRECT way to obtain the blob in async callers (P1#1 fix):
   * `stopRecording()` triggers onstop *asynchronously*; reading `audioBlob`
   * synchronously after the call always returns null / the previous value.
   */
  stopAndGetBlob: () => Promise<Blob | null>;
  /** Elapsed ms since startRecording() — 0 if not started. */
  getRecordingDurationMs: () => number;
  /**
   * Returns the peak volume (0-1) observed during the last recording session.
   * Used by callers to detect silence before sending audio to STT (Issue #2321).
   * Reset to 0 on startRecording().
   */
  getPeakVolume: () => number;
  clearRecording: () => void;
}

const MAX_DURATION_SECONDS = 120; // default 2-minute limit (short clips)

/**
 * Issue #2497 — per-flow recording caps.
 *
 * The old shared 120 s cap silently truncated long readings: a whole-article
 * KeyPassageReading (and the longest paragraphs) routinely runs 2–4 min, so the mic
 * auto-stopped mid-reading, Gemini only transcribed the captured head, and the
 * scorer marked every un-transcribed tail character as 漏念 → 27–40% false scores.
 *
 * Backend only enforces a 10 MB byte cap (opus ≈ 3 KB/s → ~55 min headroom) and a
 * 1 s minimum, so raising these is safe.  Values are generous ceilings that comfortably
 * exceed realistic reading time while still bounding runaway/idle recordings.
 */
export const FULL_READING_MAX_SECONDS = 600;  // whole-article read-aloud (≤10 min)
export const PARAGRAPH_MAX_SECONDS = 180;      // single paragraph (≤3 min)

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function useAudioRecorder(maxDurationSeconds = MAX_DURATION_SECONDS): AudioRecorderState & AudioRecorderActions {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [reachedMaxDuration, setReachedMaxDuration] = useState(false);

  const [volumeLevel, setVolumeLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  /**
   * Issue #2321 — Silence gate: tracks the maximum volume (0-1) seen during
   * the current recording session.  Reset on startRecording(); read via getPeakVolume()
   * after stopAndGetBlob() to decide whether to send the audio to STT.
   */
  const peakVolumeRef = useRef<number>(0);
  /** P1#1 fix: resolver for stopAndGetBlob() — resolved by onstop handler. */
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopVolumeMonitor = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setVolumeLevel(0);
  }, []);

  const releaseStream = useCallback(() => {
    stopVolumeMonitor();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, [stopVolumeMonitor]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopTimer();
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    // Reset previous state
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBlob(null);
    setErrorMessage('');
    setElapsedSeconds(0);
    setReachedMaxDuration(false); // Issue #2497: reset auto-stop flag for new session
    chunksRef.current = [];
    peakVolumeRef.current = 0; // Issue #2321: reset silence gate for new session

    setStatus('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const domErr = err as DOMException;
      let msg: string;
      if (domErr?.name === 'NotAllowedError' || domErr?.name === 'PermissionDeniedError') {
        msg = '麥克風權限被拒絕，請在瀏覽器設定中允許麥克風存取。';
      } else if (domErr?.name === 'NotFoundError') {
        msg = '找不到麥克風裝置，請確認麥克風已連接。';
      } else {
        msg = '無法存取麥克風，請確認裝置設定。';
      }
      setErrorMessage(msg);
      setStatus('error');
      return msg;
    }

    streamRef.current = stream;

    const mimeType = getSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      const msg = '您的瀏覽器不支援錄音功能，請使用 Chrome 或 Safari。';
      setErrorMessage(msg);
      setStatus('error');
      releaseStream();
      return msg;
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      stopTimer();
      releaseStream();
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioUrl(url);
      setStatus('stopped');
      // P1#1: resolve any pending stopAndGetBlob() promise with the final blob.
      if (stopResolverRef.current) {
        stopResolverRef.current(blob);
        stopResolverRef.current = null;
      }
    };

    recorder.onerror = () => {
      stopTimer();
      releaseStream();
      setErrorMessage('錄音過程中發生錯誤，請重試。');
      setStatus('error');
      // P1#1: also resolve on error so callers don't hang.
      if (stopResolverRef.current) {
        stopResolverRef.current(null);
        stopResolverRef.current = null;
      }
    };

    recorder.start(250); // collect data every 250ms
    startTimeRef.current = Date.now();
    setStatus('recording');

    // Setup volume monitoring via AnalyserNode
    try {
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        const level = Math.min(1, avg / 128);
        setVolumeLevel(level);
        // Issue #2321: track session peak for silence detection after recording ends.
        if (level > peakVolumeRef.current) {
          peakVolumeRef.current = level;
        }
        if (rafRef.current !== null) {
          rafRef.current = requestAnimationFrame(updateVolume);
        }
      };
      rafRef.current = requestAnimationFrame(updateVolume);
    } catch {
      // Volume monitoring is non-critical
    }

    // Countdown timer
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
      if (elapsed >= maxDurationSeconds) {
        // Issue #2497: flag the auto-stop so consumers can warn "錄音已達上限，可能未錄完".
        setReachedMaxDuration(true);
        stopRecording();
      }
    }, 500);

    return null;
  }, [audioUrl, maxDurationSeconds, stopRecording, stopTimer, releaseStream]);

  /**
   * Stop recording and await the MediaRecorder onstop event, returning the final Blob.
   *
   * Safety guarantees (P1#1 fixes):
   *  1. Timeout (3 s): if onstop never fires (browser bug / already-stopped race),
   *     resolves with the current audioBlob state (may be null) rather than hanging.
   *  2. Duplicate-call guard: if a promise is already pending, the existing resolver
   *     is settled with null and replaced — callers get independent responses.
   *  3. Already-inactive recorder: resolves immediately with current blob (no wait).
   */
  const stopAndGetBlob = useCallback((): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;

    // Not currently recording — return whatever blob we already have (may be null).
    // P2 Round 4: note that `audioBlob` is React state, so it reflects the value
    // committed during the *previous* render cycle.  In practice this is fine because:
    //  (a) if recording never started, the value is correctly null
    //  (b) if recording completed earlier (onstop already fired), state was set
    //      synchronously inside the onstop handler and will already be up-to-date
    //      by the time any subsequent render-cycle call arrives.
    // The only scenario where stale state could bite is a double-call within the
    // same synchronous frame — which the duplicate-call guard below prevents.
    if (!recorder || recorder.state === 'inactive') {
      return Promise.resolve(audioBlob);
    }

    // Duplicate-call guard: settle the previous promise before starting a new one.
    if (stopResolverRef.current) {
      stopResolverRef.current(null);
      stopResolverRef.current = null;
    }

    return new Promise<Blob | null>((resolve) => {
      // 3 s safety timeout — onstop should fire within milliseconds; 3 s is generous.
      const timer = setTimeout(() => {
        if (stopResolverRef.current === resolve) {
          stopResolverRef.current = null;
        }
        // Resolve with whatever React state has at this point (may be null on first call).
        resolve(audioBlob);
      }, 3000);

      stopResolverRef.current = (blob) => {
        clearTimeout(timer);
        resolve(blob);
      };

      // Calling recorder.stop() triggers ondataavailable (final chunk) then onstop.
      stopRecording();
    });
  }, [stopRecording, audioBlob]);

  const getRecordingDurationMs = useCallback((): number => {
    if (!startTimeRef.current) return 0;
    return Date.now() - startTimeRef.current;
  }, []);

  /**
   * Issue #2321 — Returns the peak volume level (0-1) observed during the
   * last recording session.  Call AFTER stopAndGetBlob() resolves.
   * A value below SILENT_PEAK_THRESHOLD indicates no audible speech was captured.
   */
  const getPeakVolume = useCallback((): number => {
    return peakVolumeRef.current;
  }, []);

  const clearRecording = useCallback(() => {
    // Cancel any pending stopAndGetBlob promise so it doesn't hang.
    if (stopResolverRef.current) {
      stopResolverRef.current(null);
      stopResolverRef.current = null;
    }
    stopRecording();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBlob(null);
    setErrorMessage('');
    setElapsedSeconds(0);
    setReachedMaxDuration(false); // Issue #2497
    startTimeRef.current = 0;
    setStatus('idle');
  }, [audioUrl, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopVolumeMonitor();
      releaseStream();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remainingSeconds = Math.max(0, maxDurationSeconds - elapsedSeconds);

  return {
    status,
    audioUrl,
    audioBlob,
    errorMessage,
    elapsedSeconds,
    remainingSeconds,
    volumeLevel,
    reachedMaxDuration,
    startRecording,
    stopRecording,
    stopAndGetBlob,
    getRecordingDurationMs,
    getPeakVolume,
    clearRecording,
  };
}
