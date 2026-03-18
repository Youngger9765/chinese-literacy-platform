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

export interface UseSpeechRecognitionOptions {
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  autoReconnect?: boolean;
  accumulateTranscript?: boolean;
}

type SpeechRecognitionErrorCode =
  | 'not-allowed'
  | 'no-speech'
  | 'network'
  | 'audio-capture'
  | string;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: { error: SpeechRecognitionErrorCode }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  lang = 'zh-TW',
  onTranscript?: (text: string) => void,
  options?: UseSpeechRecognitionOptions,
): SpeechRecognitionState & SpeechRecognitionActions {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
  const isSupported = SpeechRecognitionCtor !== null;

  const {
    continuous = false,
    interimResults = true,
    maxAlternatives = 1,
    autoReconnect = false,
    accumulateTranscript = false,
  } = options ?? {};

  const [status, setStatus] = useState<SpeechRecognitionStatus>(
    isSupported ? 'idle' : 'unsupported',
  );
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const shouldKeepListeningRef = useRef(false);
  const transcriptAccumRef = useRef('');

  // Keep callback ref up to date without re-running effects
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
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

    shouldKeepListeningRef.current = true;
    setErrorMessage('');
    setTranscript('');
    transcriptAccumRef.current = '';

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.interimResults = interimResults;
    recognition.continuous = continuous;
    recognition.maxAlternatives = maxAlternatives;

    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStatus('listening');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (accumulateTranscript && finalChunk) {
        transcriptAccumRef.current += finalChunk;
      }

      const displayText = accumulateTranscript
        ? `${transcriptAccumRef.current}${interim}`
        : (finalChunk || interim);

      setTranscript(displayText);

      if (finalChunk && onTranscriptRef.current) {
        onTranscriptRef.current(finalChunk);
      }
    };

    recognition.onerror = (event: { error: SpeechRecognitionErrorCode }) => {
      recognitionRef.current = null;
      shouldKeepListeningRef.current = false;
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
      recognitionRef.current = null;
      if (autoReconnect && shouldKeepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          shouldKeepListeningRef.current = false;
          setErrorMessage('語音識別已中斷，請重新啟動。');
          setStatus('error');
          return;
        }
      }
      setStatus(prev => (prev === 'listening' ? 'idle' : prev));
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setErrorMessage('無法啟動語音識別，請重試。');
      setStatus('error');
    }
  }, [SpeechRecognitionCtor, lang, interimResults, continuous, maxAlternatives, autoReconnect, accumulateTranscript]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    transcriptAccumRef.current = '';
    setErrorMessage('');
    if (status === 'error') {
      setStatus('idle');
    }
  }, [status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        shouldKeepListeningRef.current = false;
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
