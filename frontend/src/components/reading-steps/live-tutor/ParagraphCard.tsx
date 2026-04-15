import React from 'react';
import { ParagraphStatus } from '../ParagraphProgress';
import { ParagraphSummaryData, LineResult } from './liveTutorTypes';
import type { LocalEvalResult } from '../../../utils/localEval';
import { cancelTts } from '../../../services/ttsApi';
import { CHINESE_PUNCTUATION_REGEX } from '../../../utils/liveTutorHelpers';

// ── Encouraging phrase by accuracy range ─────────────────────────────────────
const ENCOURAGE: Array<{ min: number; phrases: string[]; color: string }> = [
  {
    min: 0.95,
    phrases: ['完美！太流暢了！', '讀得超棒！', '太厲害了，繼續保持！', '哇！讀得好極了！'],
    color: 'text-emerald-600',
  },
  {
    min: 0.80,
    phrases: ['讀得很好！', '棒棒！繼續加油！', '表現優秀！', '進步神速！'],
    color: 'text-green-600',
  },
  {
    min: 0.65,
    phrases: ['快到了！再仔細一點！', '再練習就更好！', '加把勁，快成功了！', '很有進步！繼續努力！'],
    color: 'text-amber-600',
  },
  {
    min: 0.50,
    phrases: ['沒關係，再試一次！', '慢慢來，你一定可以！', '別急，再讀一遍吧！'],
    color: 'text-orange-500',
  },
  {
    min: 0,
    phrases: ['別氣餒，多練習就會進步！', '一步一步來，加油！', '沒問題，我們再來一次！'],
    color: 'text-rose-500',
  },
];

function getEncouragement(matchRate: number): { phrase: string; color: string } {
  const tier = ENCOURAGE.find(t => matchRate >= t.min) ?? ENCOURAGE[ENCOURAGE.length - 1];
  const phrase = tier.phrases[Math.floor(matchRate * 1000) % tier.phrases.length];
  return { phrase, color: tier.color };
}

// ── FailedSentenceList ────────────────────────────────────────────────────────
interface FailedSentenceListProps {
  sentenceTargets: string[];
  sentenceResults: Array<LocalEvalResult | null>;
  retrySentenceIdx?: number;
  isPreparing: boolean;
  isSessionActive: boolean;
  paragraphIdx: number;
  onRetrySentence: (paragraphIdx: number, sentenceIdx: number) => void;
  onSubmitSentence: () => void;
}

const FailedSentenceList: React.FC<FailedSentenceListProps> = ({
  sentenceTargets,
  sentenceResults,
  retrySentenceIdx,
  isPreparing,
  isSessionActive,
  paragraphIdx,
  onRetrySentence,
  onSubmitSentence,
}) => {
  const failedRows = sentenceTargets
    .map((target, si) => ({ target, si, result: sentenceResults[si] }))
    .filter(({ result }) => result != null && result.matchRate < 0.6);

  if (failedRows.length === 0) return null;

  return (
    <div className="space-y-1.5 border-t border-gray-100 pt-2">
      {failedRows.map(({ target, si, result: _result }) => {
        const isRetrying = retrySentenceIdx === si;
        const canRetry = target.replace(CHINESE_PUNCTUATION_REGEX, '').length > 1;
        return (
          <div
            key={si}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              isRetrying ? 'bg-amber-50 border border-amber-200' : 'bg-white/60'
            }`}
          >
            <span className="shrink-0 text-base leading-none">❌</span>
            <span className="flex-1 text-xs text-gray-700 leading-relaxed">{target}</span>
            {canRetry && !isRetrying && (
              <button
                onClick={() => onRetrySentence(paragraphIdx, si)}
                className="shrink-0 px-2 py-1 text-xs rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-all active:scale-95"
              >
                重練這句
              </button>
            )}
            {isRetrying && (
              <>
                {isPreparing ? (
                  <span className="shrink-0 flex items-center gap-1 text-xs text-gray-400">
                    <span className="w-2 h-2 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                    準備中
                  </span>
                ) : isSessionActive ? (
                  <>
                    <span className="shrink-0 flex items-center gap-1 text-xs text-amber-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      錄音中
                    </span>
                    <button
                      onClick={onSubmitSentence}
                      className="shrink-0 px-3 py-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all active:scale-95 shadow"
                    >
                      完成
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── SummaryCard (extracted from IIFE) ────────────────────────────────────────
interface SummaryCardProps {
  paragraphSummary: ParagraphSummaryData;
  retrySentenceIdx?: number;
  isPreparing: boolean;
  isSessionActive: boolean;
  idx: number;
  storyLength: number;
  completedParagraphs: Set<number>;
  lineResults: LineResult[];
  onRetrySentence: (paragraphIdx: number, sentenceIdx: number) => void;
  onSubmitSentence: () => void;
  onRetryParagraph: (idx: number) => void;
  onAdvanceParagraph: (idx: number, lineResults: LineResult[]) => void;
  onSelectParagraph: (idx: number) => void;
}

const SummaryCard: React.FC<SummaryCardProps> = ({
  paragraphSummary, retrySentenceIdx, isPreparing, isSessionActive,
  idx, storyLength, completedParagraphs, lineResults,
  onRetrySentence, onSubmitSentence, onRetryParagraph, onAdvanceParagraph, onSelectParagraph,
}) => {
  const { phrase, color } = getEncouragement(paragraphSummary.matchRate);
  return (
    <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-gray-50 to-white shadow-card space-y-3">
      <p className="text-base font-bold text-gray-800">
        {paragraphSummary.geminiPending && <span className="text-blue-400 animate-pulse mr-1">AI 分析中...</span>}
        {paragraphSummary.feedback}
      </p>
      <p className={`text-sm font-semibold ${color}`}>{phrase}</p>

      {/* Per-sentence breakdown — only failed sentences, only when there are 2+ total sentences */}
      {paragraphSummary.sentenceTargets &&
        paragraphSummary.sentenceResults &&
        paragraphSummary.sentenceTargets.length >= 2 && (
          <FailedSentenceList
            sentenceTargets={paragraphSummary.sentenceTargets}
            sentenceResults={paragraphSummary.sentenceResults}
            retrySentenceIdx={retrySentenceIdx}
            isPreparing={isPreparing}
            isSessionActive={isSessionActive}
            paragraphIdx={idx}
            onRetrySentence={onRetrySentence}
            onSubmitSentence={onSubmitSentence}
          />
        )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => onRetryParagraph(idx)}
          className="flex-1 py-2 rounded-lg text-sm font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-all"
        >
          重練這段
        </button>
        {/* 下一段：tier 3（念太差）時隱藏，避免學生亂念後直接跳過 */}
        {/* 例外：已完成過的段落（completedParagraphs）允許自由導航 */}
        {idx < storyLength - 1 && (paragraphSummary.tier <= 2 || completedParagraphs.has(idx)) && (
          <button
            onClick={() => {
              if (!completedParagraphs.has(idx)) {
                onAdvanceParagraph(idx, lineResults);
              } else {
                onSelectParagraph(idx + 1);
              }
            }}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white transition-all"
          >
            下一段
          </button>
        )}
        {/* 完成朗讀：同樣只在通過時才顯示 */}
        {idx >= storyLength - 1 && !completedParagraphs.has(idx) && paragraphSummary.tier <= 2 && (
          <button
            onClick={() => onAdvanceParagraph(idx, lineResults)}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white transition-all"
          >
            完成朗讀
          </button>
        )}
      </div>
    </div>
  );
};

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

  const handleTtsClick = () => {
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

  return (
    <div
      className={`transition-all duration-700 rounded-2xl px-8 py-12 border ${
        isCelebrating
          ? 'bg-emerald-50 border-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.25)] scale-[1.04]'
          : status === 'current'
            ? 'bg-accent/5 border-accent/40 shadow-[0_0_40px_rgba(99,102,241,0.1)] scale-[1.03]'
            : status === 'completed'
              ? 'opacity-60 bg-emerald-50/50 border-emerald-200/50'
              : 'opacity-20 border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {/* Status indicator */}
        {status === 'completed' && (
          <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        {status === 'current' && (
          <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          </span>
        )}
        {status === 'locked' && (
          <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </span>
        )}
        <span className="text-xs text-gray-400 font-bold">第 {idx + 1} 段</span>
        {isCelebrating && (
          <span className="ml-auto text-xs font-bold text-emerald-600 animate-bounce">
            解鎖了！
          </span>
        )}
        {status === 'locked' && (
          <span className="ml-auto text-xs text-gray-400">完成前一段後解鎖</span>
        )}
        {/* Inline action buttons — system read + start/submit/retry */}
        {status !== 'locked' && !isAdvancing && (
          <div className="ml-auto flex items-center gap-2">
            {/* AI 朗讀 — hidden while actively retrying a sentence */}
            {!(isCurrentIdx && retrySentenceIdx !== undefined) && (
              <button
                onClick={handleTtsClick}
                disabled={isCurrentIdx && (isSessionActive || isPreparing)}
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all ${
                  isCurrentIdx && (isSessionActive || isPreparing)
                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    : isTtsSpeaking && isCurrentIdx
                      ? 'bg-red-100 hover:bg-red-200 text-red-600'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {isTtsSpeaking && isCurrentIdx ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="4" height="12" rx="1" /><rect x="14" y="6" width="4" height="12" rx="1" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" /></svg>
                )}
                {isTtsSpeaking && isCurrentIdx ? '停止' : 'AI 朗讀'}
              </button>
            )}
            {/* Start / Submit — hidden during sentence retry (完成 is inline in the sentence row) */}
            {isCurrentIdx ? (
              retrySentenceIdx !== undefined ? null :
              isPreparing ? (
                <button disabled className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-200 text-gray-400 cursor-wait flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  準備中...
                </button>
              ) : isSessionActive ? (
                <button
                  onClick={onSubmitSentence}
                  disabled={isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all shadow active:scale-95 ${
                    isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  完成
                </button>
              ) : !paragraphSummary ? (
                <button
                  onClick={onStartSession}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
                >
                  <span className="w-2 h-2 rounded-full bg-white" />
                  {retryCount > 0 ? '再試一次' : '開始朗讀'}
                </button>
              ) : null
            ) : (
              <button
                onClick={() => onSelectParagraph(idx)}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
              >
                <span className="w-2 h-2 rounded-full bg-white" />
                開始朗讀
              </button>
            )}
          </div>
        )}
      </div>

      {/* Paragraph text */}
      <p
        className={`leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''} ${
          status === 'current' ? 'text-gray-900 font-bold' : 'text-gray-600'
        }`}
        style={{ fontSize: fontSizePx }}
      >
        {status === 'locked' ? (
          <span className="blur-sm select-none">{zhuyinLine ?? line}</span>
        ) : (
          zhuyinLine ?? line
        )}
      </p>

      {/* Bottom-of-paragraph controls — hidden during sentence retry (完成 is inline in the sentence row) */}
      {isCurrentIdx && isSessionActive && retrySentenceIdx === undefined && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-xs text-green-600 font-medium mr-auto">聆聽中</span>
          <button
            onClick={onStopSession}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          >
            停止朗讀
          </button>
          <button
            onClick={onSubmitSentence}
            disabled={isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)}
            className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all shadow active:scale-95 ${
              isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
            完成
          </button>
        </div>
      )}

      {/* Inline summary card */}
      {paragraphSummary && (
        <SummaryCard
          paragraphSummary={paragraphSummary}
          retrySentenceIdx={retrySentenceIdx}
          isPreparing={isPreparing}
          isSessionActive={isSessionActive}
          idx={idx}
          storyLength={storyLength}
          completedParagraphs={completedParagraphs}
          lineResults={lineResults}
          onRetrySentence={onRetrySentence}
          onSubmitSentence={onSubmitSentence}
          onRetryParagraph={onRetryParagraph}
          onAdvanceParagraph={onAdvanceParagraph}
          onSelectParagraph={onSelectParagraph}
        />
      )}
    </div>
  );
};

export default ParagraphCard;
