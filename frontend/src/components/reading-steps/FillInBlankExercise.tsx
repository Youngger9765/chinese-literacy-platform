/**
 * FillInBlankExercise — ④ 語詞應用（選詞填句）(#615)
 *
 * Issue #698: one-at-a-time + disappearing word bank
 * Issue #732: first-try correctness tracking + summary screen with retry
 *
 * Redesigned to match Stitch immersive design:
 *   - Centered sentence card with inline blank
 *   - 2-column answer grid with letter badges
 *   - Hint card on wrong answer
 *   - Fixed bottom CTA
 */
import React, { useEffect, useState } from 'react';
import { FillInBlankItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';

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

const FillInBlankExercise: React.FC<Props> = ({ sentences, vocabBank, onComplete, storyId }) => {
  const bankEntries = Object.entries(vocabBank).sort(([a], [b]) => a.localeCompare(b));
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const savedProgress = loadProgress(storyId);

  const [phase, setPhase] = useState<Phase>('exercise');
  const [retryMode, setRetryMode] = useState(savedProgress?.retryMode ?? false);
  const [retryIndices, setRetryIndices] = useState<number[]>(savedProgress?.pendingRetryIndices ?? []);
  const [currentIdx, setCurrentIdx] = useState(savedProgress?.currentIdx ?? 0);
  const [usedCodes, setUsedCodes] = useState<Set<string>>(() => new Set(savedProgress?.usedCodes ?? []));
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [firstTryUsed, setFirstTryUsed] = useState(false);
  const [score, setScore] = useState(savedProgress?.score ?? 0);
  const [firstTryResults, setFirstTryResults] = useState<QuestionResult[]>(savedProgress?.firstTryResults ?? []);
  const [hintText, setHintText] = useState('');

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
  // This gives subsequent questions strategic distractor options (issue #1102 fix 3).
  const availableEntries = bankEntries;
  const currentSentence = !done ? activeSentences[currentIdx] : null;
  const currentOriginalIdx = retryMode ? retryIndices[currentIdx] : currentIdx;

  function handleSelect(code: string) {
    if (feedback === 'correct') return;
    setSelected(code);
    setFeedback('idle');
    setHintText('');
  }

  function handleConfirm() {
    if (!selected || !currentSentence) return;

    if (selected === currentSentence.answer) {
      const newUsed = new Set(usedCodes);
      newUsed.add(selected);
      setUsedCodes(newUsed);

      const alreadyRecorded = firstTryResults.some((r) => r.sentenceIdx === currentOriginalIdx);
      if (!alreadyRecorded) {
        const isFirstTryCorrect = !firstTryUsed;
        if (isFirstTryCorrect) setScore((s) => s + 1);
        setFirstTryResults((prev) => [...prev, {
          sentenceIdx: currentOriginalIdx, firstTryCorrect: isFirstTryCorrect,
          studentFirstAnswer: null, correctAnswer: currentSentence.answer,
        }]);
      }

      setFeedback('correct');
      setTimeout(() => {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setFeedback('idle');
        setFirstTryUsed(false);
        setHintText('');
      }, 900);
    } else {
      if (!firstTryUsed) {
        setFirstTryResults((prev) => {
          const alreadyRecorded = prev.some((r) => r.sentenceIdx === currentOriginalIdx);
          if (alreadyRecorded) return prev;
          return [...prev, {
            sentenceIdx: currentOriginalIdx, firstTryCorrect: false,
            studentFirstAnswer: selected, correctAnswer: currentSentence!.answer,
          }];
        });
        setFirstTryUsed(true);
      }
      setFeedback('wrong');
      setHintText(currentSentence.hint || '再想想看，正確答案是哪個詞語？');
    }
  }

  function handleRetryWrong() {
    const wrongIndices = firstTryResults.filter((r) => !r.firstTryCorrect).map((r) => r.sentenceIdx);
    setRetryIndices(wrongIndices);
    setRetryMode(true);
    setCurrentIdx(0);
    setUsedCodes(new Set());
    setSelected(null);
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
    setSelected(null);
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
  function renderSentence(sentence: string) {
    const parts = sentence.split(/[（(]　　[）)]/);
    const blankContent = selected
      ? (
        <span className={`inline-flex items-center rounded-xl px-3 py-1 mx-1 font-bold text-lg border-2 transition-all ${
          feedback === 'correct'
            ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
            : feedback === 'wrong'
            ? 'bg-tertiary-container/20 border-tertiary text-tertiary'
            : 'bg-accent/10 border-accent/40 text-accent'
        }`}>
          {zh(vocabBank[selected])}
        </span>
      )
      : (
        <span className="inline-block border-2 border-dashed border-on-surface-variant/30 rounded-xl px-5 py-1 mx-1 text-on-surface-variant/40 text-center min-w-[5em]">
          ＿＿＿
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

          {/* Per-question breakdown */}
          <div className="space-y-3">
            {sentences.map((s, idx) => {
              const qResult = firstTryResults.find((r) => r.sentenceIdx === idx);
              const correct = qResult?.firstTryCorrect ?? false;
              const correctCode = qResult?.correctAnswer ?? '';
              const wrongCode = qResult?.studentFirstAnswer ?? null;

              return (
                <div key={idx} className={`rounded-2xl p-5 ${correct ? 'bg-emerald-50' : 'bg-tertiary-container/10'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`material-symbols-outlined text-xl mt-0.5 ${correct ? 'text-emerald-600' : 'text-tertiary'}`}>
                      {correct ? 'check_circle' : 'cancel'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base text-on-surface leading-relaxed mb-1">
                        {zh(s.sentence.replace(/[（(]　　[）)]/, `【${vocabBank[correctCode] ?? correctCode}】`))}
                      </p>
                      {!correct && wrongCode && (
                        <p className="text-sm text-tertiary">
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
        <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
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

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-y-auto pb-48" style={{ fontFamily: zhuyinFont }}>
      <div className="max-w-2xl mx-auto px-6 pt-6 w-full space-y-6">

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2.5 bg-surface-container-high rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="text-sm font-headline font-bold text-on-surface-variant shrink-0">
            {currentIdx + 1} / {total}
          </span>
        </div>

        {/* Sentence card */}
        {currentSentence && (
          <div className={`rounded-3xl p-8 md:p-10 text-center transition-all duration-300 ${
            feedback === 'correct'
              ? 'bg-emerald-50 shadow-[0_8px_32px_rgba(16,185,129,0.15)]'
              : feedback === 'wrong'
              ? 'bg-surface-container-lowest shadow-editorial'
              : 'bg-surface-container-lowest shadow-editorial'
          }`}>
            <p className="text-xl md:text-2xl text-on-surface leading-[2.5rem] md:leading-[3rem]">
              {renderSentence(currentSentence.sentence)}
            </p>
          </div>
        )}

        {/* Hint card (on wrong answer) */}
        {feedback === 'wrong' && hintText && (
          <div className="rounded-2xl bg-tertiary-container/15 border border-tertiary/20 px-6 py-4 animate-fade-in">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-tertiary text-xl mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>lightbulb</span>
              <div>
                <p className="text-sm font-headline font-bold text-tertiary mb-1">再試一次！</p>
                <p className="text-sm text-on-surface leading-relaxed">{hintText}</p>
              </div>
            </div>
          </div>
        )}

        {/* Correct feedback */}
        {feedback === 'correct' && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-6 py-4 text-center animate-fade-in">
            <span className="material-symbols-outlined text-emerald-600 text-2xl">check_circle</span>
            <p className="text-sm font-headline font-bold text-emerald-700 mt-1">
              {firstTryUsed ? '答對了！' : '一次答對！'}
            </p>
          </div>
        )}

        {/* Answer options — 2-column grid */}
        {currentSentence && feedback !== 'correct' && (
          <div className="grid grid-cols-2 gap-3">
            {availableEntries.map(([code, word]) => {
              const isSelected = selected === code;
              // Words already used for previous questions stay as decoys:
              // greyed-out, non-interactive, but visible to add strategic difficulty.
              const isUsedDecoy = usedCodes.has(code);
              return (
                <button
                  key={code}
                  onClick={() => !isUsedDecoy && handleSelect(code)}
                  disabled={isUsedDecoy}
                  aria-disabled={isUsedDecoy}
                  className={`rounded-2xl border-2 p-4 text-left flex items-center gap-3 transition-all min-h-[56px] ${
                    isUsedDecoy
                      ? 'border-surface-container-high bg-surface-container-high/40 opacity-40 cursor-not-allowed'
                      : isSelected
                      ? 'border-accent bg-accent/5 shadow-sm active:scale-[0.97]'
                      : 'border-surface-container-high bg-surface-container-lowest hover:border-on-surface-variant/30 active:scale-[0.97]'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-headline font-black ${
                    isUsedDecoy
                      ? 'bg-surface-container-high text-on-surface-variant/40'
                      : isSelected
                      ? 'bg-accent text-white'
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {code}
                  </span>
                  <span className={`font-bold text-base ${
                    isUsedDecoy
                      ? 'text-on-surface-variant/40 line-through'
                      : isSelected
                      ? 'text-accent'
                      : 'text-on-surface'
                  }`}>
                    {zh(word)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Fixed bottom CTA */}
      {feedback !== 'correct' && (
        <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto">
            <button
              onClick={feedback === 'wrong' ? () => { setSelected(null); setFeedback('idle'); setHintText(''); } : handleConfirm}
              disabled={feedback === 'idle' && !selected}
              className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                feedback === 'wrong'
                  ? 'text-white shadow-[0_12px_48px_rgba(153,65,0,0.2)]'
                  : !selected
                  ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                  : 'text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)]'
              }`}
              style={
                feedback === 'wrong'
                  ? { background: 'linear-gradient(135deg, #994100, #e8945a)' }
                  : selected && feedback === 'idle'
                  ? { background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }
                  : undefined
              }
            >
              <span className="material-symbols-outlined text-xl">
                {feedback === 'wrong' ? 'refresh' : 'check_circle'}
              </span>
              {feedback === 'wrong' ? '再試一次' : selected ? '確認答案' : '請先選擇詞語'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FillInBlankExercise;
