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
}

export interface AudioRecorderActions {
  startRecording: () => Promise<void>;
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
  clearRecording: () => void;
}

const MAX_DURATION_SECONDS = 120; // 2-minute limit

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

  const [volumeLevel, setVolumeLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
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
    chunksRef.current = [];

    setStatus('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const domErr = err as DOMException;
      if (domErr?.name === 'NotAllowedError' || domErr?.name === 'PermissionDeniedError') {
        setErrorMessage('麥克風權限被拒絕，請在瀏覽器設定中允許麥克風存取。');
      } else if (domErr?.name === 'NotFoundError') {
        setErrorMessage('找不到麥克風裝置，請確認麥克風已連接。');
      } else {
        setErrorMessage('無法存取麥克風，請確認裝置設定。');
      }
      setStatus('error');
      return;
    }

    streamRef.current = stream;

    const mimeType = getSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      setErrorMessage('您的瀏覽器不支援錄音功能，請使用 Chrome 或 Safari。');
      setStatus('error');
      releaseStream();
      return;
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
        setVolumeLevel(Math.min(1, avg / 128));
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
        stopRecording();
      }
    }, 500);
  }, [audioUrl, maxDurationSeconds, stopRecording, stopTimer, releaseStream]);

  /**
   * P1#1: Stop recording and await the onstop event, returning the final Blob.
   * Safe to call even if not currently recording (returns null immediately).
   */
  const stopAndGetBlob = useCallback((): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      // Not recording — resolve immediately with whatever we already have.
      return Promise.resolve(null);
    }
    return new Promise<Blob | null>((resolve) => {
      stopResolverRef.current = resolve;
      // stopRecording() calls recorder.stop() → triggers onstop → onstop calls resolve.
      stopRecording();
    });
  }, [stopRecording]);

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
    startRecording,
    stopRecording,
    stopAndGetBlob,
    clearRecording,
  };
}
