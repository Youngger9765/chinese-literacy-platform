import React, { useRef } from 'react';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';

interface RecordingButtonProps {
  /** Maximum recording time in seconds. Default: 120 */
  maxDurationSeconds?: number;
  /** Called when a recording is completed (status transitions to 'stopped') */
  onRecordingComplete?: (blob: Blob, url: string) => void;
  /** Optional label shown above the controls */
  label?: string;
  disabled?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const RecordingButton: React.FC<RecordingButtonProps> = ({
  maxDurationSeconds = 120,
  onRecordingComplete,
  label,
  disabled = false,
}) => {
  const {
    status,
    audioUrl,
    audioBlob,
    errorMessage,
    elapsedSeconds,
    remainingSeconds,
    startRecording,
    stopRecording,
    clearRecording,
  } = useAudioRecorder(maxDurationSeconds);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Notify parent when recording completes
  const prevStatusRef = useRef(status);
  React.useEffect(() => {
    if (prevStatusRef.current !== 'stopped' && status === 'stopped' && audioBlob && audioUrl) {
      onRecordingComplete?.(audioBlob, audioUrl);
    }
    prevStatusRef.current = status;
  }, [status, audioBlob, audioUrl, onRecordingComplete]);

  const isIdle = status === 'idle';
  const isRequesting = status === 'requesting';
  const isRecording = status === 'recording';
  const isStopped = status === 'stopped';
  const isError = status === 'error';

  const urgentCountdown = remainingSeconds <= 10 && isRecording;
  const warningCountdown = remainingSeconds <= 30 && remainingSeconds > 10 && isRecording;

  return (
    <div className="flex flex-col items-center gap-3">
      {label && (
        <p className="text-sm font-medium text-gray-600">{label}</p>
      )}

      {/* Main control row */}
      <div className="flex items-center gap-3 flex-wrap justify-center">

        {/* Start / Stop button */}
        {(isIdle || isError) && (
          <button
            onClick={startRecording}
            disabled={disabled || isRequesting}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold text-sm shadow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="開始錄音"
          >
            {/* Mic icon */}
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm7 8a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-1.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
            </svg>
            開始錄音
          </button>
        )}

        {isRequesting && (
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-400 text-white font-semibold text-sm shadow cursor-not-allowed"
          >
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            等待授權...
          </button>
        )}

        {isRecording && (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-800 active:bg-gray-900 text-white font-semibold text-sm shadow transition-colors"
            aria-label="停止錄音"
          >
            {/* Stop icon */}
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            停止錄音
          </button>
        )}

        {/* Recording status indicator */}
        {isRecording && (
          <div className="flex items-center gap-2">
            {/* Pulsing red dot */}
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span
              className={`text-sm font-mono font-semibold tabular-nums ${
                urgentCountdown ? 'text-red-600' : warningCountdown ? 'text-orange-500' : 'text-gray-700'
              }`}
            >
              {formatTime(elapsedSeconds)}
            </span>
          </div>
        )}

        {/* Countdown warning when recording */}
        {(urgentCountdown || warningCountdown) && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              urgentCountdown
                ? 'bg-red-100 text-red-700'
                : 'bg-orange-100 text-orange-700'
            }`}
          >
            剩餘 {formatTime(remainingSeconds)}
          </span>
        )}
      </div>

      {/* Playback section */}
      {isStopped && audioUrl && (
        <div className="flex flex-col items-center gap-2 w-full max-w-xs">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
            </svg>
            <span>錄音完成（{formatTime(elapsedSeconds)}）</span>
          </div>

          {/* Native audio player */}
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            className="w-full h-9"
            aria-label="播放錄音"
          />

          {/* Re-record button */}
          <button
            onClick={clearRecording}
            disabled={disabled}
            className="text-xs text-gray-500 hover:text-red-500 underline transition-colors disabled:opacity-50"
          >
            重新錄音
          </button>
        </div>
      )}

      {/* Error message */}
      {isError && errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 max-w-xs"
        >
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* First-time permission hint */}
      {isRequesting && (
        <p className="text-xs text-gray-500 max-w-xs text-center">
          請在瀏覽器彈出視窗中允許麥克風存取。
        </p>
      )}
    </div>
  );
};

export default RecordingButton;
