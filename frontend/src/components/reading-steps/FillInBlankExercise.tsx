/**
 * FillInBlankExercise — ④ 語詞應用（選詞填句）(#615)
 *
 * Issue #698: one-at-a-time + disappearing word bank
 * Issue #732: first-try correctness tracking + summary screen with retry
 * Issue #2082 (A6/A10/A11/A12):
 *   A10 — selecting an option immediately evaluates; confirm button removed
 *   A6  — correct → rotating praise; wrong → amber "再試試看！" (not red)
 *   A12 — wrong answer never reveals the correct answer; retryable
 *   A11 — text-left, smaller dashed blank, "第 N 題 / 共 M 題" heading,
 *          ABCD badges behind FILLBLANK_SHOW_ABCD feature flag (default false)
 */
import React, { useEffect, useState } from 'react';
import { FillInBlankItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import { FILLBLANK_SHOW_ABCD } from '../../config/featureFlags';

interface Props {
  sentences: FillInBlankItem[];
  vocabBank: Record<string, string>;
  onComplete: (score: number, total: number, firstTryResults?: QuestionResult[]) => void;
  storyId?: string | number;
}

export interface QuestionResult {
  sentenceIdx: number;
  firstTryCorrect: boolean;
  studentFirstAnswer: string | null;
  correctAnswer: string;
}

// localStorage helpers — must use scopedStepStorageKey so toolbox/assignment
// runs are isolated from self-practice (#1460).
function storageKey(storyId: string | number | undefined): string | null {
  return storyId != null ? scopedStepStorageKey('vocab_app_progress_', storyId) : null;
}

interface SavedProgress {
  currentIdx: number;
  usedCodes: string[];
  score: number;
  firstTryResults: QuestionResult[];
  pendingRetryIndices?: number[];
  retryMode?: boolean;
}

function loadProgress(storyId: string | number | undefined): SavedProgress | null {
  const key = storageKey(storyId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedProgress;
    if (typeof parsed.currentIdx === 'number' && Array.isArray(parsed.usedCodes)) return parsed;
    return null;
  } catch { return null; }
}

function saveProgress(storyId: string | number | undefined, data: SavedProgress): void {
  const key = storageKey(storyId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function clearAnswers(storyId: string | number | undefined): void {
  const key = storageKey(storyId);
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
}

type Phase = 'exercise' | 'summary';

// A6: rotating correct praise messages
const CORRECT_PRAISES = ['答對了！', '太棒了！', '很厲害！', '完全正確！', '你答對了！'];
let praiseIdx = 0;
function nextPraise(): string {
  const msg = CORRECT_PRAISES[praiseIdx % CORRECT_PRAISES.length];
  praiseIdx++;
  return msg;
}

const FillInBlankExercise: React.FC<Props> = ({ sentences, vocabBank, onComplete, storyId }) => {
  const bankEntries = Object.entries(vocabBank).sort(([a], [b]) => a.localeCompare(b));
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const savedProgress = loadProgress(storyId);

  const [phase, setPhase] = useState<Phase>('exercise');
  const [retryMode, setRetryMode] = useState(savedProgress?.retryMode ?? false);
  const [retryIndices, setRetryIndices] = useState<number[]>(savedProgress?.pendingRetryIndices ?? []);
  const [currentIdx, setCurrentIdx] = useState(savedProgress?.currentIdx ?? 0);
  const [usedCodes, setUsedCodes] = useState<Set<string>>(() => new Set(savedProgress?.usedCodes ?? []));
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [firstTryUsed, setFirstTryUsed] = useState(false);
  const [score, setScore] = useState(savedProgress?.score ?? 0);
  const [firstTryResults, setFirstTryResults] = useState<QuestionResult[]>(savedProgress?.firstTryResults ?? []);
  const [hintText, setHintText] = useState('');
  // A6: hold current praise so it doesn't re-roll mid-display
  const [currentPraise, setCurrentPraise] = useState('答對了！');

  const activeSentences: FillInBlankItem[] = retryMode
    ? retryIndices.map((i) => sentences[i])
    : sentences;
  const total = activeSentences.length;
  const done = currentIdx >= total;

  useEffect(() => {
    if (storyId == null) return;
    saveProgress(storyId, {
      currentIdx, usedCodes: Array.from(usedCodes), score, firstTryResults,
      pendingRetryIndices: retryIndices, retryMode,
    });
  }, [currentIdx, usedCodes, score, firstTryResults, retryIndices, retryMode, storyId]);

  useEffect(() => {
    if (done && phase === 'exercise') setPhase('summary');
  }, [done, phase]);

  // Show all bank entries; used ones stay visible as decoys (greyed-out, non-selectable).
  const availableEntries = bankEntries;
  const currentSentence = !done ? activeSentences[currentIdx] : null;
  const currentOriginalIdx = retryMode ? retryIndices[currentIdx] : currentIdx;

  // A10: selecting immediately evaluates — no separate confirm button
  function handleSelect(code: string) {
    if (feedback === 'correct') return; // already correct, guard early return (preserve A10 note)
    if (!currentSentence) return;

    if (code === currentSentence.answer) {
      const newUsed = new Set(usedCodes);
      newUsed.add(code);
      setUsedCodes(newUsed);

      const alreadyRecorded = firstTryResults.some((r) => r.sentenceIdx === currentOriginalIdx);
      if (!alreadyRecorded) {
        const isFirstTryCorrect = !firstTryUsed;
        if (isFirstTryCorrect) setScore((s) => s + 1);
        setFirstTryResults((prev) => [...prev, {
          sentenceIdx: currentOriginalIdx,
          firstTryCorrect: isFirstTryCorrect,
          studentFirstAnswer: null,
          correctAnswer: currentSentence.answer,
        }]);
      }

      // A6: pick praise before setting feedback
      setCurrentPraise(nextPraise());
      setFeedback('correct');

      // A10: auto-advance ~800ms after correct
      setTimeout(() => {
        setCurrentIdx((i) => i + 1);
        setFeedback('idle');
        setFirstTryUsed(false);
        setHintText('');
      }, 800);
    } else {
      // A12: wrong → do NOT reveal correct answer; keep retryable
      if (!firstTryUsed) {
        setFirstTryResults((prev) => {
          const alreadyRecorded = prev.some((r) => r.sentenceIdx === currentOriginalIdx);
          if (alreadyRecorded) return prev;
          return [...prev, {
            sentenceIdx: currentOriginalIdx,
            firstTryCorrect: false,
            studentFirstAnswer: code,
            correctAnswer: currentSentence!.answer,
          }];
        });
        setFirstTryUsed(true);
      }
      // A6: amber wrong feedback (not red)
      setFeedback('wrong');
      setHintText('再試試看！');
    }
  }

  function handleRetryWrong() {
    const wrongIndices = firstTryResults.filter((r) => !r.firstTryCorrect).map((r) => r.sentenceIdx);
    setRetryIndices(wrongIndices);
    setRetryMode(true);
    setCurrentIdx(0);
    setUsedCodes(new Set());
    setFeedback('idle');
    setFirstTryUsed(false);
    setHintText('');
    setPhase('exercise');
  }

  function handleRetryAll() {
    setRetryMode(false);
    setRetryIndices([]);
    setCurrentIdx(0);
    setUsedCodes(new Set());
    setScore(0);
    setFirstTryResults([]);
    setFeedback('idle');
    setFirstTryUsed(false);
    setHintText('');
    setPhase('exercise');
    clearAnswers(storyId);
  }

  // ── Zhuyin helper ────────────────────────────────────────────────
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  const zhuyinFont = fontForZhuyin(zhuyinActive);

  // ── Render sentence with inline blank ─────────────────────────────
  // A11: blank box shrunk to ~3.5em with dashed underline style
  function renderSentence(sentence: string, selectedCode: string | null) {
    const parts = sentence.split(/[（(]　　[）)]/);
    const blankContent = selectedCode
      ? (
        <span className={`inline-flex items-center rounded-lg px-2 py-0.5 mx-1 font-bold text-lg border-2 transition-all ${
          feedback === 'correct'
            ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
            : feedback === 'wrong'
            ? 'bg-amber-50 border-amber-400 text-amber-800'
            : 'bg-accent/10 border-accent/40 text-accent'
        }`}>
          {zh(vocabBank[selectedCode])}
        </span>
      )
      : (
        // A11: smaller dashed underline blank, not big pill
        <span className="inline-block border-b-2 border-dashed border-on-surface-variant/40 mx-1 text-on-surface-variant/40 text-center min-w-[3.5em] pb-0.5">
          ＿＿
        </span>
      );

    return <>{zh(parts[0])}{blankContent}{zh(parts[1] ?? '')}</>;
  }

  // ── Summary screen ──────────────────────────────────────────────
  if (phase === 'summary') {
    const firstTryScore = firstTryResults.filter((r) => r.firstTryCorrect).length;
    const firstTryTotal = sentences.length;
    const allCorrect = firstTryScore === firstTryTotal;
    const wrongCount = firstTryResults.filter((r) => !r.firstTryCorrect).length;

    return (
      <div className="flex-1 flex flex-col bg-surface overflow-y-auto pb-48" style={{ fontFamily: zhuyinFont }}>
        <div className="max-w-2xl mx-auto px-6 pt-8 w-full space-y-6">
          {/* Score */}
          <div className={`rounded-3xl p-8 text-center ${allCorrect ? 'bg-emerald-50' : 'bg-surface-container-lowest shadow-editorial'}`}>
            <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${allCorrect ? 'bg-emerald-100' : 'bg-tertiary-container/20'}`}>
              <span className={`material-symbols-outlined text-4xl ${allCorrect ? 'text-emerald-600' : 'text-tertiary'}`}>
                {allCorrect ? 'emoji_events' : 'school'}
              </span>
            </div>
            <p className="text-2xl font-headline font-black text-on-surface mb-1">
              {allCorrect ? '全部答對！' : '你完成了！'}
            </p>
            <p className="text-sm text-on-surface-variant">
              {allCorrect ? '每一題都一次答對，表現優異！' : '以下是各題的作答結果'}
            </p>
          </div>

          {/* Per-question breakdown — summary is the ONLY place correct answers are shown (A12) */}
          <div className="space-y-3">
            {sentences.map((s, idx) => {
              const qResult = firstTryResults.find((r) => r.sentenceIdx === idx);
              const correct = qResult?.firstTryCorrect ?? false;
              const correctCode = qResult?.correctAnswer ?? '';
              const wrongCode = qResult?.studentFirstAnswer ?? null;

              return (
                <div key={idx} className={`rounded-2xl p-5 ${correct ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`material-symbols-outlined text-xl mt-0.5 ${correct ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {correct ? 'check_circle' : 'cancel'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base text-on-surface leading-relaxed mb-1">
                        {zh(s.sentence.replace(/[（(]　　[）)]/, `【${vocabBank[correctCode] ?? correctCode}】`))}
                      </p>
                      {!correct && wrongCode && (
                        <p className="text-sm text-amber-700">
                          你選了 <span className="font-bold">{zh(vocabBank[wrongCode] ?? wrongCode)}</span>
                          <span className="text-on-surface-variant mx-1">→</span>
                          正確：<span className="font-bold text-emerald-700">{zh(vocabBank[correctCode] ?? correctCode)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Fixed bottom CTA */}
        <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto flex flex-col gap-2">
            {isToolboxMode() ? (
              <ToolboxCompletionActions onRetry={handleRetryAll} className="w-full" />
            ) : (
              <>
                {wrongCount > 0 && (
                  <button onClick={handleRetryWrong}
                    className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all">
                    重做錯題（{wrongCount} 題）
                  </button>
                )}
                <button onClick={handleRetryAll}
                  className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all">
                  全部重做
                </button>
                <button onClick={() => onComplete(firstTryScore, firstTryTotal, firstTryResults)}
                  className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                  繼續下一步
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Exercise screen ───────────────────────────────────────────────
  const progressPercent = total > 0 ? ((currentIdx) / total) * 100 : 0;
  // A11: "第 N 題 / 共 M 題" display numbers (1-indexed)
  const questionNumber = currentIdx + 1;

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-y-auto pb-32" style={{ fontFamily: zhuyinFont }}>
      <div className="max-w-2xl mx-auto px-6 pt-6 w-full space-y-5">

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-surface-container-high rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="text-sm font-headline font-bold text-on-surface-variant shrink-0">
            {currentIdx + 1} / {total}
          </span>
        </div>

        {/* A11: per-question heading "第 N 題 / 共 M 題" */}
        {currentSentence && (
          <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wide">
            第 {questionNumber} 題 / 共 {total} 題
          </p>
        )}

        {/* Sentence card — A11: text-left + comfortable leading */}
        {currentSentence && (
          <div className={`rounded-3xl p-6 md:p-8 transition-all duration-300 ${
            feedback === 'correct'
              ? 'bg-emerald-50 shadow-[0_8px_32px_rgba(16,185,129,0.15)]'
              : feedback === 'wrong'
              ? 'bg-amber-50 shadow-[0_4px_16px_rgba(217,119,6,0.1)]'
              : 'bg-surface-container-lowest shadow-editorial'
          }`}>
            {/* A11: text-left (not text-center) */}
            <p className="text-xl md:text-2xl text-on-surface leading-[2.6rem] md:leading-[3.2rem] text-left">
              {renderSentence(currentSentence.sentence, null)}
            </p>
          </div>
        )}

        {/* A6: wrong feedback — amber, "再試試看！", no correct answer shown (A12) */}
        {feedback === 'wrong' && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-amber-600 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                refresh
              </span>
              <div>
                <p className="text-sm font-headline font-bold text-amber-700">再試試看！</p>
                {hintText && hintText !== '再試試看！' && (
                  <p className="text-sm text-on-surface leading-relaxed mt-0.5">{hintText}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* A6: correct feedback — praise */}
        {feedback === 'correct' && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-3 text-center animate-fade-in">
            <span className="material-symbols-outlined text-emerald-600 text-2xl">check_circle</span>
            <p className="text-sm font-headline font-bold text-emerald-700 mt-1">
              {currentPraise}
            </p>
          </div>
        )}

        {/* Answer options — A11: ABCD badges behind feature flag; A10: click = immediate evaluate */}
        {currentSentence && feedback !== 'correct' && (
          <div className="grid grid-cols-2 gap-3">
            {availableEntries.map(([code, word]) => {
              const isUsedDecoy = usedCodes.has(code);
              // A6/A12: when wrong, show which was just selected as amber highlight (no reveal of correct)
              const isWrongSelected =
                feedback === 'wrong' &&
                firstTryResults.length > 0 &&
                firstTryResults[firstTryResults.length - 1]?.studentFirstAnswer === code &&
                firstTryResults[firstTryResults.length - 1]?.sentenceIdx === currentOriginalIdx;

              return (
                <button
                  key={code}
                  onClick={() => !isUsedDecoy && handleSelect(code)}
                  disabled={isUsedDecoy}
                  aria-disabled={isUsedDecoy}
                  className={`rounded-2xl border-2 p-4 text-left flex items-center gap-3 transition-all min-h-[56px] ${
                    isUsedDecoy
                      ? 'border-surface-container-high bg-surface-container-high/40 opacity-40 cursor-not-allowed'
                      : isWrongSelected
                      ? 'border-amber-400 bg-amber-50 active:scale-[0.97]'
                      : 'border-surface-container-high bg-surface-container-lowest hover:border-on-surface-variant/30 hover:bg-surface-container-low active:scale-[0.97]'
                  }`}
                >
                  {/* A11: ABCD badge behind feature flag */}
                  {FILLBLANK_SHOW_ABCD && (
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-headline font-black ${
                      isUsedDecoy
                        ? 'bg-surface-container-high text-on-surface-variant/40'
                        : isWrongSelected
                        ? 'bg-amber-400 text-white'
                        : 'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {code}
                    </span>
                  )}
                  <span className={`font-bold text-base ${
                    isUsedDecoy
                      ? 'text-on-surface-variant/40 line-through'
                      : isWrongSelected
                      ? 'text-amber-700'
                      : 'text-on-surface'
                  }`}>
                    {zh(word)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* A10: no confirm button — selecting triggers immediate evaluation.
            Show a gentle "try again" nudge only when in wrong state so user knows to tap another option. */}
        {feedback === 'wrong' && currentSentence && (
          <p className="text-xs text-center text-on-surface-variant">
            點選其他選項繼續作答
          </p>
        )}

      </div>
    </div>
  );
};

export default FillInBlankExercise;
