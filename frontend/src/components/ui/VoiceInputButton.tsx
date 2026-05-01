import React from 'react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface VoiceInputButtonProps {
  /** Called with the full accumulated transcript whenever a new final result arrives */
  onTranscript: (text: string) => void;
  /**
   * Called on every interim + final result change so callers can render live
   * transcript text while the user is still speaking. Issue #1327.
   */
  onLiveTranscript?: (text: string) => void;
  /** Speech recognition language (default 'zh-TW') */
  lang?: string;
  /** Disable the button externally (e.g. while parent is submitting) */
  disabled?: boolean;
  /** Extra Tailwind classes applied to the button */
  className?: string;
  /** Size variant: default 'md' (40px), 'sm' (32px) */
  size?: 'sm' | 'md';
  /**
   * Optional ref that the parent can use to imperatively stop recording.
   * Assign stopListening to this ref so e.g. the submit handler can call
   * stopRef.current?.() before validating. Issue #1327.
   */
  stopRef?: React.MutableRefObject<(() => void) | null>;
}

/**
 * VoiceInputButton — shared mic button for any text input surface.
 *
 * Wraps useSpeechRecognition so callers only deal with plain text.
 * Issue #1094: abstract voice input into a reusable component so every
 * text-input surface (SentencePractice, ComprehensionChat, ...) can support
 * speaking instead of typing.
 * Issue #1327: exposes onLiveTranscript so callers can render interim results.
 */
const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  onTranscript,
  onLiveTranscript,
  lang = 'zh-TW',
  disabled = false,
  className = '',
  size = 'md',
  stopRef,
}) => {
  const { status, transcript, errorMessage, isSupported, startListening, stopListening } =
    useSpeechRecognition(lang, onTranscript);

  // Expose stopListening to parent via stopRef so it can halt recording
  // imperatively (e.g. when the submit / 批改 button is clicked). (#1327)
  React.useEffect(() => {
    if (stopRef) stopRef.current = stopListening;
    return () => { if (stopRef) stopRef.current = null; };
  }, [stopRef, stopListening]);

  // Propagate live transcript (interim + accumulated finals) to caller (#1327).
  const prevTranscriptRef = React.useRef('');
  React.useEffect(() => {
    if (!onLiveTranscript) return;
    if (transcript !== prevTranscriptRef.current) {
      prevTranscriptRef.current = transcript;
      onLiveTranscript(transcript);
    }
  }, [transcript, onLiveTranscript]);

  const isListening = status === 'listening';
  const unsupported = !isSupported || status === 'unsupported';

  const dimension = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const iconSize = size === 'sm' ? 'text-lg' : 'text-xl';

  const title = unsupported
    ? '此瀏覽器不支援語音輸入，請使用 Chrome 或 Safari'
    : isListening
    ? '點擊停止錄音'
    : errorMessage || '點擊開始語音輸入';

  const handleClick = () => {
    if (isListening) stopListening();
    else startListening();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={unsupported || disabled}
      title={title}
      aria-label={isListening ? '停止語音輸入' : '語音輸入'}
      aria-pressed={isListening}
      className={`${dimension} shrink-0 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
        unsupported || disabled
          ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
          : isListening
          ? 'bg-red-500 text-white animate-pulse'
          : 'bg-accent/10 text-accent hover:bg-accent/20'
      } ${className}`}
    >
      <span className={`material-symbols-outlined ${iconSize}`} aria-hidden="true">
        {isListening ? 'stop' : 'mic'}
      </span>
    </button>
  );
};

export default VoiceInputButton;
