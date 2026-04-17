import React, { useMemo } from 'react';
import ParagraphProgress, { ParagraphStatus } from '../ParagraphProgress';
import { ParagraphSummaryData, LineResult } from './liveTutorTypes';
import { cancelTts } from '../../../services/ttsApi';
import { splitIntoSentences } from '../../../utils/localEval';
import { CHINESE_PUNCTUATION_REGEX } from '../../../utils/liveTutorHelpers';

import { splitZhuyinChars } from '../../../utils/zhuyinUtils';

interface ParagraphCardProps {
  idx: number;
  line: string;
  status: ParagraphStatus;
  isCelebrating: boolean;
  currentLineIndex: number;
  isAdvancing: boolean;
  fontSizePx: string | number;
  zhuyinLine: React.ReactNode | null;
  zhuyinActive: boolean;
  // STT state
  isSessionActive: boolean;
  isPreparing: boolean;
  // TTS state
  isTtsSpeaking: boolean;
  /** Current character position during TTS playback (0-based) */
  speakingProgress: number;
  utteranceRef: React.MutableRefObject<HTMLAudioElement | SpeechSynthesisUtterance | null>;
  ttsRafRef: React.MutableRefObject<number | null>;
  // Evaluation state
  streamingUserInput: string;
  lastDiffTokens: import('../../../types').DiffToken[] | null;
  isAwaitingGemini: boolean;
  retryCount: number;
  paragraphSummary: ParagraphSummaryData | null;
  completedParagraphs: Set<number>;
  storyLength: number;
  lineResults: LineResult[];
  /** All paragraph statuses — for the embedded progress bar */
  allStatuses: ParagraphStatus[];
  // Actions
  onSelectParagraph: (idx: number) => void;
  onTtsToggle: (idx: number) => void;
  onStartSession: () => void;
  onStopSession: () => void;
  onSubmitSentence: () => void;
  onRetryParagraph: (idx: number) => void;
  onRetrySentence: (paragraphIdx: number, sentenceIdx: number) => void;
  retrySentenceIdx?: number;
  onAdvanceParagraph: (idx: number, lineResults: LineResult[]) => void;
  setIsTtsSpeaking: (v: boolean) => void;
  setIsTtsPaused: (v: boolean) => void;
  storyContent: string[];
}

const ParagraphCard: React.FC<ParagraphCardProps> = ({
  idx,
  line,
  status,
  isCelebrating,
  currentLineIndex,
  isAdvancing,
  fontSizePx,
  zhuyinLine,
  zhuyinActive,
  isSessionActive,
  isPreparing,
  isTtsSpeaking,
  speakingProgress,
  utteranceRef,
  ttsRafRef,
  streamingUserInput,
  lastDiffTokens,
  isAwaitingGemini,
  retryCount,
  paragraphSummary,
  completedParagraphs,
  storyLength,
  lineResults,
  allStatuses,
  onSelectParagraph,
  onTtsToggle,
  onStartSession,
  onStopSession,
  onSubmitSentence,
  onRetryParagraph,
  onRetrySentence,
  retrySentenceIdx,
  onAdvanceParagraph,
  setIsTtsSpeaking,
  setIsTtsPaused,
  storyContent,
}) => {
  const isCurrentIdx = idx === currentLineIndex;
  const [ttsLoading, setTtsLoading] = React.useState(false);

  const handleTtsClick = () => {
    if (ttsLoading) return; // debounce
    if (idx !== currentLineIndex) {
      onSelectParagraph(idx);
    }
    if (isTtsSpeaking) {
      if (utteranceRef.current) {
        const u = utteranceRef.current;
        if (u instanceof HTMLAudioElement) {
          u.onended = null;
          u.onerror = null;
          u.pause();
        } else {
          (u as SpeechSynthesisUtterance).onend = null;
          (u as SpeechSynthesisUtterance).onerror = null;
          (u as SpeechSynthesisUtterance).onboundary = null;
        }
        utteranceRef.current = null;
      }
      if (ttsRafRef.current !== null) {
        cancelAnimationFrame(ttsRafRef.current);
        ttsRafRef.current = null;
      }
      cancelTts();
      setIsTtsSpeaking(false);
      setIsTtsPaused(false);
    } else {
      setTtsLoading(true);
      onTtsToggle(idx);
      // Clear loading after TTS starts or after timeout
      setTimeout(() => setTtsLoading(false), 5000);
    }
  };

  // Clear loading when TTS actually starts playing
  React.useEffect(() => {
    if (isTtsSpeaking) setTtsLoading(false);
  }, [isTtsSpeaking]);

  return (
    <div
      className={`transition-all duration-500 rounded-3xl p-5 md:p-14 ${
        isCelebrating
          ? 'bg-emerald-50 shadow-[0_12px_48px_rgba(16,185,129,0.15)]'
          : status === 'current'
            ? 'bg-surface-container-lowest shadow-editorial'
            : status === 'completed'
              ? 'bg-surface-container-lowest/60'
              : 'bg-surface-container-low/40'
      }`}
    >
      {/* Header: paragraph number + status */}
      <div className="flex items-center gap-3 mb-3">
        <div className="px-4 py-1.5 bg-surface-container-high rounded-full">
          <span className="font-headline text-on-surface-variant font-bold text-sm tracking-wide">
            第 {idx + 1} / {storyLength} 段
          </span>
        </div>
        {isCelebrating && (
          <span className="text-sm font-bold text-emerald-600 animate-bounce">通過了！</span>
        )}
        {status === 'completed' && !isCelebrating && (
          <span className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
      </div>

      {/* Progress bar — embedded inside card */}
      <div className="mb-8">
        <ParagraphProgress
          statuses={allStatuses}
          currentIndex={idx}
          onSelectParagraph={(i) => {
            if (allStatuses[i] !== 'locked') onSelectParagraph(i);
          }}
        />
      </div>

      {/* Paragraph text — with TTS character highlight */}
      <p
        className={`text-on-surface/90 ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}
        style={{
          fontSize: fontSizePx,
          lineHeight: zhuyinActive ? '3.8rem' : '2.0',
        }}
      >
        {status === 'locked' ? (
          <span className="blur-sm select-none">{zhuyinLine ?? line}</span>
        ) : isTtsSpeaking && isCurrentIdx ? (
          // Highlight chars up to speakingProgress during TTS playback
          (() => {
            const displayText = (zhuyinActive && typeof zhuyinLine === 'string') ? zhuyinLine : line;
            const chars = splitZhuyinChars(displayText);
            return (
              <>
                {speakingProgress > 0 && (
                  <span className="text-accent font-bold">{chars.slice(0, speakingProgress).join('')}</span>
                )}
                <span className={speakingProgress > 0 ? 'text-on-surface/30' : 'text-on-surface/90'}>
                  {chars.slice(speakingProgress).join('')}
                </span>
              </>
            );
          })()
        ) : (
          zhuyinLine ?? line
        )}
      </p>

      {/* ── Recording state: realtime transcript display ─────── */}
      {isCurrentIdx && isSessionActive && (
        <div className="mt-8 flex flex-col items-center gap-4">
          <div className="w-full bg-surface-container-low rounded-2xl p-4">
            <p className="text-xs font-bold text-accent uppercase tracking-widest mb-2 animate-pulse">即時辨識</p>
            <p className="text-lg text-on-surface leading-relaxed min-h-[2em]">
              {streamingUserInput || <span className="text-on-surface-variant/40">請開始朗讀…</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-emerald-600 font-medium">聆聽中...</span>
          </div>
        </div>
      )}

      {/* Action buttons moved to LiveTutor fixed bottom CTA */}

      {/* ── Not current paragraph: small "go to" button ────────────── */}
      {!isCurrentIdx && status !== 'locked' && !isAdvancing && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => onSelectParagraph(idx)}
            className="px-6 py-2.5 rounded-full text-sm font-bold bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest flex items-center gap-2 transition-all"
          >
            <span className="material-symbols-outlined text-lg">mic</span>
            朗讀這段
          </button>
        </div>
      )}

      {/* ── Diff token display (color-coded reading result) ────────── */}
      {lastDiffTokens && !isSessionActive && (
        <div className="mt-6 p-4 bg-surface-container-low rounded-2xl">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">朗讀結果</p>
          <p className="text-lg leading-relaxed">
            {lastDiffTokens.map((t, i) => (
              <span
                key={i}
                className={
                  t.type === 'correct' ? 'text-emerald-600 font-medium' :
                  t.type === 'forgiven' ? 'text-blue-500' :
                  t.type === 'wrong' ? 'text-tertiary line-through' :
                  t.type === 'missing' ? 'text-on-surface-variant/30' :
                  'text-on-surface'
                }
              >
                {t.char}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* ── Sentence retry in progress banner (#1076) ──────────────── */}
      {isCurrentIdx && retrySentenceIdx !== undefined && (
        <div className="mt-6 p-4 rounded-2xl bg-accent/10 border border-accent/30 text-sm text-accent flex items-center gap-3">
          <span className="material-symbols-outlined text-base">volume_up</span>
          重念第 {retrySentenceIdx + 1} 句中…念完按「完成」送出
        </div>
      )}

      {/* ── Inline summary card (after evaluation) ─────────────────── */}
      {paragraphSummary && retrySentenceIdx === undefined && (
        <div className="mt-8 p-6 rounded-2xl bg-surface-container-low space-y-4">
          <p className="text-base font-bold text-on-surface">
            {paragraphSummary.geminiPending && <span className="text-accent animate-pulse mr-1">AI 分析中...</span>}
            {paragraphSummary.feedback}
          </p>
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-600 font-medium">
              正確率 {Math.round(paragraphSummary.matchRate * 100)}%
            </span>
            {paragraphSummary.wrongCount > 0 && (
              <span className="text-tertiary">念錯 {paragraphSummary.wrongCount} 字</span>
            )}
            {paragraphSummary.missingCount > 0 && (
              <span className="text-on-surface-variant">漏字 {paragraphSummary.missingCount} 字</span>
            )}
          </div>

          {/* Sentence-level retry (#1076) — show when there are errors */}
          {isCurrentIdx && (paragraphSummary.wrongCount > 0 || paragraphSummary.missingCount > 0) && (() => {
            const sentences = splitIntoSentences(line || '');
            const retryable = sentences
              .map((text, i) => ({ text, i }))
              .filter(({ text }) => text.replace(CHINESE_PUNCTUATION_REGEX, '').length > 1);
            if (retryable.length === 0) return null;
            return (
              <div className="pt-2 border-t border-on-surface/10">
                <p className="text-xs font-bold text-on-surface-variant mb-2">重念某一句</p>
                <div className="flex flex-wrap gap-2">
                  {retryable.map(({ text, i }) => (
                    <button
                      key={i}
                      onClick={() => onRetrySentence(idx, i)}
                      className="px-3 py-1.5 rounded-full text-xs bg-surface-container-highest hover:bg-accent/20 text-on-surface transition-all"
                      title={text}
                    >
                      第 {i + 1} 句
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Action buttons */}
          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => onRetryParagraph(idx)}
              className="btn-encourage !text-sm !py-2.5 !px-6 !min-h-0"
            >
              重練這段
            </button>
            {idx < storyLength - 1 && (
              <button
                onClick={() => {
                  if (!completedParagraphs.has(idx)) {
                    onAdvanceParagraph(idx, lineResults);
                  } else {
                    onSelectParagraph(idx + 1);
                  }
                }}
                className="px-6 py-2.5 rounded-full text-sm font-bold text-white transition-all active:scale-95 flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                下一段
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
            )}
            {idx >= storyLength - 1 && !completedParagraphs.has(idx) && (
              <button
                onClick={() => onAdvanceParagraph(idx, lineResults)}
                className="px-6 py-2.5 rounded-full text-sm font-bold text-white transition-all active:scale-95 flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                完成朗讀
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ParagraphCard;
