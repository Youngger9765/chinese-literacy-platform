import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { speakText as azureSpeakText, cancelTts } from '../../services/ttsApi';

interface PronunciationPracticeProps {
  character: string;
  zhuyin?: string;
  onComplete: () => void;
  onBack: () => void;
}

type PracticeState = 'idle' | 'playing-reference' | 'ready-to-record' | 'recording' | 'comparing' | 'done';

const MAX_ATTEMPTS = 3;
const SHORT_RECORDING_SECONDS = 5;

function speakCharacter(character: string): Promise<void> {
  return azureSpeakText(character);
}

const PronunciationPractice: React.FC<PronunciationPracticeProps> = ({
  character,
  zhuyin,
  onComplete,
  onBack,
}) => {
  const [practiceState, setPracticeState] = useState<PracticeState>('idle');
  const [attempts, setAttempts] = useState(0);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const referenceAudioRef = useRef<HTMLAudioElement | null>(null);
  const studentAudioRef = useRef<HTMLAudioElement | null>(null);

  const recorder = useAudioRecorder(SHORT_RECORDING_SECONDS);

  // Capture reference pronunciation via TTS into a blob URL using MediaStreamAudioDestinationNode
  // Since Web Speech API doesn't expose audio output as a stream directly, we use a simpler
  // approach: play TTS and let user hear it, store the utterance text for replay.
  // For playback comparison, we replay TTS (reference) vs recorded audio (student).

  const playReference = useCallback(async () => {
    setPracticeState('playing-reference');
    setTtsError('');
    try {
      await speakCharacter(character);
      setPracticeState('ready-to-record');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '播放失敗';
      setTtsError(msg);
      setPracticeState('idle');
    }
  }, [character]);

  const handleStartRecording = useCallback(async () => {
    setPracticeState('recording');
    setFeedbackMessage('');
    await recorder.startRecording();
  }, [recorder]);

  const handleStopRecording = useCallback(() => {
    recorder.stopRecording();
  }, [recorder]);

  // When recorder finishes (status becomes 'stopped'), advance to comparing state
  useEffect(() => {
    if (recorder.status === 'stopped' && practiceState === 'recording') {
      setPracticeState('comparing');
      setAttempts(prev => prev + 1);
    }
  }, [recorder.status, practiceState]);

  // Auto-stop recording when max duration reached
  useEffect(() => {
    if (recorder.status === 'stopped' && recorder.audioUrl) {
      setReferenceUrl(recorder.audioUrl);
    }
  }, [recorder.status, recorder.audioUrl]);

  const playStudentRecording = useCallback(() => {
    if (!recorder.audioUrl) return;
    if (studentAudioRef.current) {
      studentAudioRef.current.pause();
      studentAudioRef.current.currentTime = 0;
    }
    const audio = new Audio(recorder.audioUrl);
    studentAudioRef.current = audio;
    audio.play().catch(() => {});
  }, [recorder.audioUrl]);

  const playReferenceAgain = useCallback(async () => {
    await speakCharacter(character);
  }, [character]);

  const handleRetry = useCallback(() => {
    recorder.clearRecording();
    setReferenceUrl(null);
    setFeedbackMessage('');
    setPracticeState('idle');
  }, [recorder]);

  const handleMarkCorrect = useCallback(() => {
    setFeedbackMessage('發音正確！');
    setPracticeState('done');
  }, []);

  const handleMarkNeedsWork = useCallback(() => {
    if (attempts >= MAX_ATTEMPTS) {
      setFeedbackMessage(`已練習 ${attempts} 次，繼續加油！`);
      setPracticeState('done');
    } else {
      setFeedbackMessage('再試一次！');
      recorder.clearRecording();
      setReferenceUrl(null);
      setPracticeState('idle');
    }
  }, [attempts, recorder]);

  // Cleanup audio refs on unmount
  useEffect(() => {
    return () => {
      if (referenceAudioRef.current) {
        referenceAudioRef.current.pause();
      }
      if (studentAudioRef.current) {
        studentAudioRef.current.pause();
      }
      cancelTts();
    };
  }, []);

  const attemptsLeft = MAX_ATTEMPTS - attempts;

  return (
    <div className="flex-1 flex flex-col bg-amber-50 overflow-hidden">
      {/* Tab bar */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
        <button
          onClick={onBack}
          className="h-full px-3 flex items-center text-gray-500 hover:text-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800 gap-2">
          發音練習 — {character}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-500 pr-2">
          已練習 {attempts} / {MAX_ATTEMPTS} 次
        </span>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-md mx-auto space-y-8">

          {/* Character display */}
          <div className="text-center">
            <div className="inline-flex flex-col items-center bg-white rounded-3xl shadow-lg border border-gray-100 px-10 py-6">
              <span className="text-7xl font-bold text-gray-900 leading-none">{character}</span>
              {zhuyin && (
                <span className="text-xl text-gray-500 mt-2" style={{ fontFamily: "'BpmfIansui', sans-serif" }}>
                  {zhuyin}
                </span>
              )}
            </div>
          </div>

          {/* Attempt dots */}
          <div className="flex justify-center gap-2">
            {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full border-2 transition-all ${
                  i < attempts
                    ? 'border-accent bg-accent'
                    : 'border-gray-300 bg-transparent'
                }`}
              />
            ))}
          </div>

          {/* State: idle — prompt to hear reference */}
          {practiceState === 'idle' && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-gray-600 text-center">
                先聽正確發音，再錄音跟讀。
              </p>
              <button
                onClick={playReference}
                className="flex items-center gap-3 px-8 py-4 bg-blue-500 hover:bg-blue-600 text-white font-bold text-base rounded-2xl shadow-lg transition-all active:scale-95"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                聆聽正確發音
              </button>
              {ttsError && (
                <p className="text-red-500 text-sm text-center">{ttsError}</p>
              )}
            </div>
          )}

          {/* State: playing reference */}
          {practiceState === 'playing-reference' && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3 text-blue-600">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className="w-1.5 bg-blue-500 rounded-full animate-pulse"
                      style={{
                        height: `${16 + i * 8}px`,
                        animationDelay: `${i * 150}ms`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm font-medium">正在播放...</span>
              </div>
            </div>
          )}

          {/* State: ready to record */}
          {practiceState === 'ready-to-record' && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-gray-600 text-center">
                現在換你了！按下錄音，念出這個字。
              </p>
              <div className="flex flex-col items-center gap-3 w-full">
                <button
                  onClick={playReference}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-sm rounded-xl transition-all active:scale-95"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  再聽一次
                </button>
                <button
                  onClick={handleStartRecording}
                  className="flex items-center gap-3 px-8 py-4 bg-red-500 hover:bg-red-600 text-white font-bold text-base rounded-2xl shadow-lg transition-all active:scale-95"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
                  </svg>
                  開始錄音
                </button>
              </div>
              {attemptsLeft < MAX_ATTEMPTS && (
                <p className="text-xs text-gray-400">還可以練習 {attemptsLeft} 次</p>
              )}
            </div>
          )}

          {/* State: recording */}
          {practiceState === 'recording' && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3 text-red-500">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium">
                  錄音中... ({recorder.elapsedSeconds}s / {SHORT_RECORDING_SECONDS}s)
                </span>
              </div>
              <p className="text-sm text-gray-600 text-center">
                請念出「{character}」
              </p>
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-3 px-8 py-4 bg-gray-700 hover:bg-gray-800 text-white font-bold text-base rounded-2xl shadow-lg transition-all active:scale-95"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                停止錄音
              </button>
              {recorder.errorMessage && (
                <p className="text-red-500 text-sm text-center">{recorder.errorMessage}</p>
              )}
            </div>
          )}

          {/* State: comparing — playback both */}
          {practiceState === 'comparing' && (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-gray-600 text-center font-medium">
                比較你的錄音和標準發音
              </p>

              {/* Reference audio */}
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm-1.5-11.5v9l6-4.5z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-blue-700 font-semibold">標準發音</p>
                </div>
                <button
                  onClick={playReferenceAgain}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-all active:scale-95"
                >
                  播放
                </button>
              </div>

              {/* Student audio */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-emerald-700 font-semibold">你的錄音</p>
                </div>
                <button
                  onClick={playStudentRecording}
                  disabled={!recorder.audioUrl}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all active:scale-95"
                >
                  播放
                </button>
              </div>

              {/* Self-assessment */}
              <div className="flex flex-col items-center gap-3 pt-2">
                <p className="text-sm text-gray-600 font-medium">你覺得發音怎麼樣？</p>
                <div className="flex gap-3 w-full">
                  <button
                    onClick={handleMarkCorrect}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    正確！
                  </button>
                  <button
                    onClick={handleMarkNeedsWork}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    再試一次
                  </button>
                </div>
                {attemptsLeft <= 0 && (
                  <p className="text-xs text-gray-400">已達最大練習次數</p>
                )}
              </div>
            </div>
          )}

          {/* State: done */}
          {practiceState === 'done' && (
            <div className="flex flex-col items-center gap-5">
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-6 text-center w-full">
                <p className="text-emerald-700 font-bold text-lg">
                  {feedbackMessage || '練習完成！'}
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  共練習了 {attempts} 次
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={handleRetry}
                  className="flex-1 py-3 border border-gray-300 hover:border-gray-400 text-gray-600 font-medium rounded-xl transition-all active:scale-95 text-sm"
                >
                  再練一次
                </button>
                <button
                  onClick={onComplete}
                  className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-sm rounded-full shadow-sm transition-all active:scale-95"
                >
                  完成
                </button>
              </div>
            </div>
          )}

          {/* Recorder error (mic permission etc.) */}
          {recorder.status === 'error' && recorder.errorMessage && practiceState !== 'done' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
              <p className="text-red-600 text-sm">{recorder.errorMessage}</p>
              <button
                onClick={() => {
                  recorder.clearRecording();
                  setPracticeState('ready-to-record');
                }}
                className="mt-2 text-red-500 hover:text-red-700 text-xs underline"
              >
                重試
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default PronunciationPractice;
