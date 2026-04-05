/**
 * ParagraphCard — renders a single paragraph card in LiveTutor.
 * Extracted from the story.content.map body in LiveTutor.tsx — zero behavior changes.
 */

import React from 'react';
import { DiffToken, Story } from '../../../types';
import { ParagraphStatus } from '../ParagraphProgress';
import { cancelTts } from '../../../services/ttsApi';
import { LineResult } from './helpers';

interface ParagraphSummaryData {
  feedback: string;
  matchRate: number;
  wrongCount: number;
  missingCount: number;
  tier: number;
  geminiPending: boolean;
}

export interface ParagraphCardProps {
  idx: number;
  line: string;
  status: ParagraphStatus;
  isCelebrating: boolean;
  currentLineIndex: number;
  stt: {
    isSessionActive: boolean;
    isPreparing: boolean;
  };
  fontSizePx: string | number;
  zhuyinActive: boolean;
  zhuyinLines: React.ReactNode[] | null;
  completedParagraphs: Set<number>;
  paragraphSummaries: Record<number, ParagraphSummaryData>;
  isAdvancing: boolean;
  isAwaitingGemini: boolean;
  isTtsSpeaking: boolean;
  utteranceRef: React.MutableRefObject<HTMLAudioElement | SpeechSynthesisUtterance | null>;
  ttsRafRef: React.MutableRefObject<number | null>;
  speakCurrentParagraph: () => void;
  streamingUserInput: string;
  lastDiffTokens: DiffToken[] | null;
  activeLineRef: React.RefObject<HTMLDivElement>;
  story: Story;
  lineResults: LineResult[];
  retryCount: number;
  // Actions
  startSession: () => void;
  stopSession: () => void;
  submitSentence: () => Promise<void>;
  advanceParagraph: (lineIdx: number, allLineResults: LineResult[]) => void;
  setCurrentLineIndex: (idx: number) => void;
  setRetryCount: (count: number) => void;
  setParagraphSummaries: React.Dispatch<React.SetStateAction<Record<number, ParagraphSummaryData>>>;
  setRealtimeDiffTokens: React.Dispatch<React.SetStateAction<DiffToken[] | null>>;
  setLastDiffTokens: React.Dispatch<React.SetStateAction<DiffToken[] | null>>;
  setIsTtsSpeaking: (v: boolean) => void;
  setIsTtsPaused: (v: boolean) => void;
}

const ParagraphCard: React.FC<ParagraphCardProps> = ({
  idx,
  line,
  status,
  isCelebrating,
  currentLineIndex,
  stt,
  fontSizePx,
  zhuyinActive,
  zhuyinLines,
  completedParagraphs,
  paragraphSummaries,
  isAdvancing,
  isAwaitingGemini,
  isTtsSpeaking,
  utteranceRef,
  ttsRafRef,
  speakCurrentParagraph,
  streamingUserInput,
  lastDiffTokens,
  activeLineRef,
  story,
  lineResults,
  retryCount,
  startSession,
  stopSession,
  submitSentence,
  advanceParagraph,
  setCurrentLineIndex,
  setRetryCount,
  setParagraphSummaries,
  setRealtimeDiffTokens,
  setLastDiffTokens,
  setIsTtsSpeaking,
  setIsTtsPaused,
}) => {
  return (
    <div
      key={idx}
      ref={idx === currentLineIndex ? activeLineRef : null}
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
            {/* System demo — available on all non-locked paragraphs */}
            <button
              onClick={() => {
                if (idx !== currentLineIndex) { stopSession(); setRetryCount(0); setCurrentLineIndex(idx); }
                if (isTtsSpeaking) {
                  if (utteranceRef.current) { const _u = utteranceRef.current; if (_u instanceof HTMLAudioElement) { _u.onended = null; _u.onerror = null; _u.pause(); } else { (_u as SpeechSynthesisUtterance).onend = null; (_u as SpeechSynthesisUtterance).onerror = null; (_u as SpeechSynthesisUtterance).onboundary = null; } utteranceRef.current = null; }
                  if (ttsRafRef.current !== null) { cancelAnimationFrame(ttsRafRef.current); ttsRafRef.current = null; }
                  cancelTts();
                  setIsTtsSpeaking(false); setIsTtsPaused(false);
                } else {
                  if (idx === currentLineIndex) {
                    speakCurrentParagraph();
                  } else {
                    const text = story.content[idx];
                    if (text) {
                      cancelTts();
                      setIsTtsSpeaking(true);
                      import('../../../services/ttsApi').then(({ speakText: sp }) => {
                        sp(text).finally(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); });
                      });
                    }
                  }
                }
              }}
              disabled={idx === currentLineIndex && (stt.isSessionActive || stt.isPreparing)}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all ${
                idx === currentLineIndex && (stt.isSessionActive || stt.isPreparing)
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : isTtsSpeaking && idx === currentLineIndex
                    ? 'bg-red-100 hover:bg-red-200 text-red-600'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              {isTtsSpeaking && idx === currentLineIndex ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="4" height="12" rx="1" /><rect x="14" y="6" width="4" height="12" rx="1" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" /></svg>
              )}
              {isTtsSpeaking && idx === currentLineIndex ? '停止' : 'AI 朗讀'}
            </button>
            {/* Start / Submit / Retry — context-dependent */}
            {idx === currentLineIndex ? (
              stt.isPreparing ? (
                <button disabled className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-200 text-gray-400 cursor-wait flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  準備中...
                </button>
              ) : stt.isSessionActive ? (
                <button
                  onClick={submitSentence}
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
              ) : !paragraphSummaries[idx] ? (
                <button
                  onClick={startSession}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
                >
                  <span className="w-2 h-2 rounded-full bg-white" />
                  {retryCount > 0 ? '再試一次' : '開始朗讀'}
                </button>
              ) : null
            ) : (
              <button
                onClick={() => {
                  stopSession(); setRetryCount(0); setCurrentLineIndex(idx);
                }}
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
          <span className="blur-sm select-none">{zhuyinLines ? zhuyinLines[idx] : line}</span>
        ) : (
          zhuyinLines ? zhuyinLines[idx] : line
        )}
      </p>

      {/* Bottom-of-paragraph controls — complete + stop (visible while recording this paragraph) */}
      {idx === currentLineIndex && stt.isSessionActive && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-xs text-green-600 font-medium mr-auto">聆聽中</span>
          <button
            onClick={stopSession}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          >
            停止朗讀
          </button>
          <button
            onClick={submitSentence}
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
      {(() => {
        const summary = paragraphSummaries[idx];
        if (!summary) return null;
        return (
          <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-gray-50 to-white shadow-card space-y-3">
            <p className="text-base font-bold text-gray-800">
              {summary.geminiPending && <span className="text-blue-400 animate-pulse mr-1">AI 分析中...</span>}
              {summary.feedback}
            </p>
            <div className="flex gap-4 text-sm">
              <span className="text-green-600 font-medium">
                正確率 {Math.round(summary.matchRate * 100)}%
              </span>
              {summary.wrongCount > 0 && (
                <span className="text-red-500">念錯 {summary.wrongCount} 字</span>
              )}
              {summary.missingCount > 0 && (
                <span className="text-gray-400">漏字 {summary.missingCount} 字</span>
              )}
            </div>
            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (idx !== currentLineIndex) {
                    stopSession(); setRetryCount(0); setCurrentLineIndex(idx);
                  }
                  setParagraphSummaries(prev => { const next = { ...prev }; delete next[idx]; return next; });
                  setRealtimeDiffTokens(null);
                  setLastDiffTokens(null);
                  if (idx === currentLineIndex) { startSession(); }
                  else { setTimeout(() => startSession(), 100); }
                }}
                className="flex-1 py-2 rounded-lg text-sm font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-all"
              >
                重練這段
              </button>
              {idx < story.content.length - 1 && (
                <button
                  onClick={() => {
                    if (!completedParagraphs.has(idx)) {
                      advanceParagraph(idx, lineResults);
                    } else {
                      setCurrentLineIndex(idx + 1);
                    }
                  }}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                    summary.tier <= 2
                      ? 'bg-accent hover:bg-accent-hover text-white'
                      : 'border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-600'
                  }`}
                >
                  下一段
                </button>
              )}
              {idx >= story.content.length - 1 && !completedParagraphs.has(idx) && (
                <button
                  onClick={() => advanceParagraph(idx, lineResults)}
                  className="flex-1 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white transition-all"
                >
                  完成朗讀
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ParagraphCard;
