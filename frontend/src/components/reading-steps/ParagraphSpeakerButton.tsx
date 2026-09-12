/**
 * ParagraphSpeakerButton — the 喇叭 next to a paragraph's number in
 * 讀全文-做記號, which reads that one paragraph aloud (#3141).
 *
 * Owner ask: 「在每一段的開頭數字旁邊加一個喇叭，點下去就會播放該段落的語音」.
 *
 * There is no new audio behind this and no new endpoint. The whole-lesson
 * player already walks the lesson one paragraph at a time via
 * `speakText(text, lessonId, paragraphIdx, roundSlug)`, and 逐段朗讀 has had a
 * per-paragraph 「AI 朗讀」 button on that same call since long before this.
 * Both address the same canonical sentences, so the audio this button plays is
 * byte-for-byte the file those two already play — same text, same
 * sha256(corrections fingerprint + text), same object under
 * gs://lingoleap-tts-cache/azure/sentences/.
 *
 * Deliberately dumb, like ReadingPlayer: it owns no audio and no timers. The
 * engine is useFullTextTtsQueue, which is also what drives the reading
 * highlight and scroll-into-view — so this button gets both for free by
 * reporting `isActive` from the same `currentParagraphIdx` the highlight reads.
 *
 * ⛔ Do NOT move this inside <AnnotatedParagraph>. It must stay outside the
 * [data-para-idx] subtree: its markup would otherwise inflate the character
 * offsets that annotations are stored against, and in 標記模式 it would sit
 * inside the [data-ci] character grid that charAtPoint resolves taps through.
 * See the comment at its call site in FullTextAnnotate.tsx.
 */
import React from 'react';

export interface ParagraphSpeakerButtonProps {
  /** 0-based paragraph index — the same index the TTS cache is keyed on. */
  paraIdx: number;
  /** This paragraph is the one currently loading, playing or paused. */
  isActive: boolean;
  /** The reader is fetching/synthesising and no audio byte has played yet. */
  isLoading: boolean;
  onPlay: (idx: number) => void;
  onStop: () => void;
}

const ParagraphSpeakerButton: React.FC<ParagraphSpeakerButtonProps> = ({
  paraIdx,
  isActive,
  isLoading,
  onPlay,
  onStop,
}) => {
  // `isLoading` is the reader's, not this paragraph's — it means "some
  // paragraph is loading". Only this button's own row may show a spinner,
  // otherwise every speaker on the page spins while one of them loads.
  const showSpinner = isActive && isLoading;
  const label = isActive
    ? `停止朗讀第 ${paraIdx + 1} 段`
    : `朗讀第 ${paraIdx + 1} 段`;

  return (
    <button
      type="button"
      // A second tap on the paragraph that is already sounding stops it, rather
      // than restarting it from the top — restarting is the one thing a student
      // who taps again is not asking for. Tapping a DIFFERENT paragraph's
      // speaker switches to it; useFullTextTtsQueue supersedes the old walk.
      onClick={() => (isActive ? onStop() : onPlay(paraIdx))}
      aria-label={label}
      title={label}
      data-testid={`paragraph-speaker-${paraIdx}`}
      data-active={isActive ? 'true' : undefined}
      className={`flex items-center justify-center w-6 h-6 rounded-full transition-all active:scale-90 ${
        isActive
          ? 'text-accent bg-accent/10'
          : 'text-on-surface-variant/40 hover:text-accent hover:bg-accent/10'
      }`}
    >
      <span
        className={`material-symbols-outlined text-base leading-none ${
          isActive && !showSpinner ? 'animate-pulse' : ''
        }`}
        style={{ fontVariationSettings: "'FILL' 1" }}
        aria-hidden="true"
      >
        {showSpinner ? 'hourglass_top' : isActive ? 'stop_circle' : 'volume_up'}
      </span>
    </button>
  );
};

export default ParagraphSpeakerButton;
