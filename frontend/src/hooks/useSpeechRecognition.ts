import { useState, useRef, useCallback, useEffect } from 'react';

export type SpeechRecognitionStatus = 'idle' | 'listening' | 'error' | 'unsupported';

export interface SpeechRecognitionState {
  status: SpeechRecognitionStatus;
  transcript: string;
  errorMessage: string;
  isSupported: boolean;
}

export interface SpeechRecognitionActions {
  startListening: () => void;
  stopListening: () => void;
  clearTranscript: () => void;
}

/** Maximum recording duration in milliseconds (60 seconds) */
const MAX_RECORDING_DURATION_MS = 60_000;
/** Stop recording after this many milliseconds of silence (no new results) */
const SILENCE_TIMEOUT_MS = 3_000;

function getSpeechRecognitionConstructor(): typeof SpeechRecognition | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  lang = 'zh-TW',
  onTranscript?: (text: string) => void,
): SpeechRecognitionState & SpeechRecognitionActions {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
  const isSupported = SpeechRecognitionCtor !== null;

  const [status, setStatus] = useState<SpeechRecognitionStatus>(
    isSupported ? 'idle' : 'unsupported',
  );
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Accumulated final results across multiple onresult events (continuous mode) */
  const accumulatedFinalRef = useRef('');

  // Keep callback ref up to date without re-running effects
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setStatus(prev => (prev === 'listening' ? 'idle' : prev));
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      setStatus('unsupported');
      return;
    }

    // Stop any in-progress session first
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    setErrorMessage('');
    setTranscript('');
    accumulatedFinalRef.current = '';

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStatus('listening');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Reset silence timer — user is still speaking (#1327).
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      silenceTimerRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, SILENCE_TIMEOUT_MS);

      let interim = '';
      let newFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          newFinal += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (newFinal) {
        accumulatedFinalRef.current += newFinal;
      }

      // Show accumulated finals + current interim for live feedback
      const display = accumulatedFinalRef.current + interim;
      setTranscript(display);

      if (newFinal && onTranscriptRef.current) {
        onTranscriptRef.current(accumulatedFinalRef.current);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (maxDurationTimerRef.current) {
        clearTimeout(maxDurationTimerRef.current);
        maxDurationTimerRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recognitionRef.current = null;
      switch (event.error) {
        case 'not-allowed':
          setErrorMessage('麥克風權限被拒絕，請在瀏覽器設定中允許麥克風存取。');
          break;
        case 'no-speech':
          setErrorMessage('沒有偵測到語音，請再試一次。');
          break;
        case 'network':
          setErrorMessage('網路連線問題，請確認網路後再試。');
          break;
        case 'audio-capture':
          setErrorMessage('找不到麥克風裝置，請確認麥克風已連接。');
          break;
        default:
          setErrorMessage('語音識別發生錯誤，請再試一次。');
      }
      setStatus('error');
    };

    recognition.onend = () => {
      if (maxDurationTimerRef.current) {
        clearTimeout(maxDurationTimerRef.current);
        maxDurationTimerRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recognitionRef.current = null;
      setStatus(prev => (prev === 'listening' ? 'idle' : prev));
    };

    try {
      recognition.start();
      // Auto-stop after max duration to prevent infinite recording
      maxDurationTimerRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, MAX_RECORDING_DURATION_MS);
    } catch {
      recognitionRef.current = null;
      setErrorMessage('無法啟動語音識別，請重試。');
      setStatus('error');
    }
  }, [SpeechRecognitionCtor, lang]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setErrorMessage('');
    accumulatedFinalRef.current = '';
    if (status === 'error') {
      setStatus('idle');
    }
  }, [status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (maxDurationTimerRef.current) {
        clearTimeout(maxDurationTimerRef.current);
        maxDurationTimerRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    status,
    transcript,
    errorMessage,
    isSupported,
    startListening,
    stopListening,
    clearTranscript,
  };
}
