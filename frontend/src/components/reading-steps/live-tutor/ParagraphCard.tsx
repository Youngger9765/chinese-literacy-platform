import React, { useMemo } from 'react';
import ParagraphProgress, { ParagraphStatus } from '../ParagraphProgress';
import { ParagraphSummaryData, LineResult } from './liveTutorTypes';
import { cancelTts } from '../../../services/ttsApi';
import { splitIntoSentences } from '../../../utils/localEval';
import { CHINESE_PUNCTUATION_REGEX } from '../../../utils/liveTutorHelpers';

import { splitZhuyinChars } from '../../../utils/zhuyinUtils';
import { groupIdxForProgress } from '../../../utils/ttsHighlight';
import { useKaraoke } from '../../../context/KaraokeContext';
import { interleavePunctuation } from '../../../utils/textDiff';

/* ── Encouragement messages (PR #1076 / #1096) ──────────────────────────── */

const ENCOURAGE_TIERS: Array<{ min: number; color: string; msgs: string[] }> = [
  { min: 0.95, color: 'text-emerald-600', msgs: ['完美！太流暢了！', '讀得超棒！', '太厲害了！', '好厲害，一字不差！'] },
  { min: 0.80, color: 'text-green-600', msgs: ['讀得很好！', '棒棒！繼續加油！', '很不錯喔！', '表現很棒！'] },
  { min: 0.65, color: 'text-green-600', msgs: ['讀得不錯！', '很好喔，再練一下更好！', '進步很多了！'] },
  { min: 0.50, color: 'text-amber-600', msgs: ['有進步喔！再試一次會更好！', '很努力！繼續加油！', '你做得到的！'] },
  { min: 0, color: 'text-amber-600', msgs: ['沒關係，我們再試一次！', '慢慢來，不著急！', '多練幾次就會了！'] },
];

function getEncouragement(matchRate: number): { text: string; color: string } {
  const tier = ENCOURAGE_TIERS.find(t => matchRate >= t.min) ?? ENCOURAGE_TIERS[ENCOURAGE_TIERS.length - 1];
  const idx = Math.floor(matchRate * 1000) % tier.msgs.length;
  return { text: tier.msgs[idx], color: tier.color };
}

/* ── Component ──────────────────────────────────────────────────────────── */

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
  /** True while audio is being fetched (before first byte plays). */
  isTtsLoading: boolean;
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
  isTtsLoading,
  speakingProgress,
  utteranceRef,
  ttsRafRef,
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
  const { karaokeEnabled } = useKaraoke();

  const readingResultTokens = useMemo(
    () => (lastDiffTokens ? interleavePunctuation(line, lastDiffTokens) : null),
    [line, lastDiffTokens],
  );

  // isTtsLoading comes from useTtsPlayback hook (via LiveTutor) — no local state needed.
  // This removes the old setTimeout-based debounce that was an approximation.

  const handleTtsClick = () => {
    if (isTtsLoading) return; // debounce: ignore if still fetching
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
      onTtsToggle(idx);
    }
  };

  // Encouragement for summary display
  const encouragement = useMemo(() => {
    if (!paragraphSummary) return null;
    return getEncouragement(paragraphSummary.matchRate);
  }, [paragraphSummary?.matchRate]);

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
        className={`text-on-surface/90 ${zhuyinActive ? 'tracking-[0.15em]' : ''}`}
        style={{
          fontSize: fontSizePx,
          lineHeight: zhuyinActive ? '2.4rem' : '1.6', /* ruby annotations need 2.4rem minimum to avoid clipping */
        }}
      >
        {status === 'locked' ? (
          <span className="blur-sm select-none">{zhuyinLine ?? line}</span>
        ) : isTtsSpeaking && isCurrentIdx && karaokeEnabled ? (
          // KTV highlight: scrolls char-by-char during TTS playback.
          // Only shown when karaokeEnabled is true (toggle in ImmersiveTopBar).
          // groupIdxForProgress walks char groups so zhuyin PUA selectors
          // (#1112) and symbols stripped by _cleanForTts (#1110) don't push
          // the split past the real char boundary.
          (() => {
            const displayText = (zhuyinActive && typeof zhuyinLine === 'string') ? zhuyinLine : line;
            const chars = splitZhuyinChars(displayText);
            const splitIdx = groupIdxForProgress(chars, speakingProgress);
            return (
              <>
                {speakingProgress > 0 && (
                  <span className="text-accent font-bold">{chars.slice(0, splitIdx).join('')}</span>
                )}
                <span className={speakingProgress > 0 ? 'text-on-surface/30' : 'text-on-surface/90'}>
                  {chars.slice(splitIdx).join('')}
                </span>
              </>
            );
          })()
        ) : (
          zhuyinLine ?? line
        )}
      </p>

      {/* Recording indicator + CTA live in LiveTutorControls (fixed bottom bar) */}

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
      {readingResultTokens && !isSessionActive && (
        <div className="mt-6 p-4 bg-surface-container-low rounded-2xl">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">朗讀結果</p>
          <p className="text-lg leading-relaxed">
            {readingResultTokens.map((t, i) => (
              <span
                key={i}
                className={
                  t.type === 'punctuation' ? 'text-on-surface' :
                  t.type === 'correct' ? 'text-emerald-600 font-medium' :
                  t.type === 'forgiven' ? 'text-blue-500' :
                  t.type === 'wrong' ? 'text-tertiary line-through' :
                  t.type === 'missing' || t.type === 'unread' ? 'text-on-surface-variant/30' :
                  'text-on-surface'
                }
              >
                {t.char}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* ── Inline summary card (after evaluation) ─────────────────── */}
      {paragraphSummary && (
        <div className="mt-8 p-6 rounded-2xl bg-surface-container-low space-y-4">
          {/* Encouragement message instead of raw numbers (#1076) */}
          <div className="flex items-center gap-3">
            {paragraphSummary.geminiPending && (
              <span className="text-accent animate-pulse text-sm">AI 分析中...</span>
            )}
            {encouragement && (
              <p className={`text-lg font-bold ${encouragement.color}`}>
                {encouragement.text}
              </p>
            )}
          </div>

          {/* CPM + accuracy scores (Issue #2147) */}
          {(() => {
            const cpmVal = lineResults.find(r => r.lineIndex === idx)?.cpm ?? null;
            const rate = paragraphSummary.matchRate;
            if (cpmVal === null) return null;
            const rateColor = rate >= 0.9 ? 'text-emerald-600' : rate >= 0.65 ? 'text-green-600' : 'text-amber-600';
            return (
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-on-surface-variant">speed</span>
                  <span className="text-on-surface-variant">語速</span>
                  <span className="font-bold text-on-surface">{cpmVal}</span>
                  <span className="text-on-surface-variant text-xs">字/分</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-on-surface-variant">check_circle</span>
                  <span className="text-on-surface-variant">正確率</span>
                  <span className={`font-bold ${rateColor}`}>{Math.round(rate * 100)}%</span>
                </div>
              </div>
            );
          })()}

          {/* Sentence-level retry — show whenever there are failed sentences */}
          {isCurrentIdx && (() => {
            const targets = paragraphSummary.sentenceTargets ?? splitIntoSentences(line || '');
            const results = paragraphSummary.sentenceResults ?? [];
            const hasEvalResults = results.some(r => r !== null);

            // Build failed sentence list — per-sentence 判斷（以句號分段）
            // matchRate < 0.5 = 該句超過半數字唸錯/漏念，需要重練
            // null result（未個別評估）→ 用段落整體 matchRate 推斷
            const SENTENCE_FAIL_THRESHOLD = 0.5;
            const failedSentences = targets
              .map((text, si) => ({ text, si, result: results[si] ?? null }))
              .filter(({ text, result }) => {
                const cleanLen = text.replace(CHINESE_PUNCTUATION_REGEX, '').length;
                if (cleanLen <= 1) return false;
                if (result !== null) {
                  // 有逐句結果 → 直接判斷
                  return result.matchRate < SENTENCE_FAIL_THRESHOLD;
                }
                // 無逐句結果 → 用段落 matchRate 推斷（段落差就全部列出）
                return paragraphSummary.matchRate < SENTENCE_FAIL_THRESHOLD;
              });

            const totalRetryable = targets.filter(t => t.replace(CHINESE_PUNCTUATION_REGEX, '').length > 1).length;

            // Rule 2: if > half the sentences failed → suggest redo, but advancement is never blocked.
            // Retry suggestion is advisory UI only — score never gates paragraph progress. (#1318, #2185)
            if (failedSentences.length > totalRetryable / 2) {
              const canAdvanceRule2 = true; // advancement is never blocked by score
              return (
                <div className="pt-3 border-t border-on-surface/10">
                  <p className="text-sm text-on-surface-variant text-center">
                    繼續加油！再唸一次一定會更好！
                  </p>
                </div>
              );
            }

            if (failedSentences.length === 0) return null;

            // Rule 1: show individual failed sentences for retry
            return (
              <div className="pt-3 border-t border-on-surface/10 space-y-2">
                <p className="text-xs font-bold text-on-surface-variant mb-1">加強練習這幾句</p>
                {failedSentences.map(({ text, si }) => {
                  const isRetrying = retrySentenceIdx === si;
                  return (
                    <div
                      key={si}
                      className={`flex items-center gap-2 p-2.5 rounded-xl text-sm transition-all ${
                        isRetrying ? 'bg-amber-50 border border-amber-200' : 'bg-surface-container-lowest'
                      }`}
                    >
                      <span className="flex-1 text-on-surface/80 leading-relaxed">{text}</span>
                      {!isRetrying && (
                        <button
                          onClick={() => onRetrySentence(idx, si)}
                          className="px-3 py-1 rounded-full text-xs font-bold bg-accent/10 text-accent hover:bg-accent/20 transition-all shrink-0"
                        >
                          重練這句
                        </button>
                      )}
                      {isRetrying && isSessionActive && (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="flex items-center gap-1 text-xs text-amber-600">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            錄音中
                          </span>
                          <button
                            onClick={onSubmitSentence}
                            className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-all"
                          >
                            完成
                          </button>
                        </div>
                      )}
                      {isRetrying && isPreparing && (
                        <span className="text-xs text-on-surface-variant shrink-0">準備中...</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Action buttons — hidden during sentence retry */}
          {retrySentenceIdx === undefined && (() => {
            // Advancement is never blocked by score — retry suggestions are advisory UI only. (#1318, #2185)
            const canAdvance = true; // advancement is never blocked by score

            return (
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={() => onRetryParagraph(idx)}
                className="btn-encourage !text-sm !py-2.5 !px-6 !min-h-0"
              >
                重練這段
              </button>
              {/* Always show 下一段 — never block paragraph progress (#2172) */}
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
              {idx >= storyLength - 1 && !completedParagraphs.has(idx) && canAdvance && (
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
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default ParagraphCard;
