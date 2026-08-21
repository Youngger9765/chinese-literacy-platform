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
 * Issue #2163: OnboardingCoach — first-use amber説明框 + demo animation on real UI
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FillInBlankItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import { FILLBLANK_SHOW_ABCD, FILLBLANK_OPTION_MODE } from '../../config/featureFlags';
import QuizCompletionScreen from '../learning/QuizCompletionScreen';

// A8: Detect touch (coarse pointer) vs mouse at mount time.
const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

// ── localStorage key for first-use onboarding gate ────────────────────────
const FILLBLANK_ONBOARDED_KEY = 'fillblank_onboarded';

// ── Demo step tooltip bubble ───────────────────────────────────────────────
function DemoBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl bg-accent text-white px-4 py-2 text-sm font-bold shadow-lg text-center max-w-xs">
        {children}
        <span
          className="absolute left-1/2 -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 bg-accent"
          aria-hidden
        />
      </div>
    </div>
  );
}

type DemoStep = 'read-sentence' | 'pick' | 'click' | 'success';

interface DemoRuntime {
  step: DemoStep;
  targetCode: string;
}

// ── Onboarding coach — amber box, same style as VocabDefinitionMatchMCQ ──
interface OnboardingCoachProps {
  onDismiss: () => void;
  onDemo: () => void;
}

function OnboardingCoach({ onDismiss, onDemo }: OnboardingCoachProps) {
  return (
    <div className="mb-5 rounded-2xl border-2 border-amber-400/60 bg-amber-50 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-500 text-2xl flex-shrink-0 mt-0.5">
          lightbulb
        </span>
        <div className="flex-1">
          <p className="font-bold text-on-surface text-base mb-1">語詞應用怎麼玩？</p>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            讀句子，從下面選出最適合填進空格的語詞。
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-end">
        <button
          type="button"
          onClick={onDemo}
          className="px-4 py-2 rounded-full text-sm font-bold border-2 border-accent text-accent hover:bg-accent/10 active:scale-[0.98] transition-all"
        >
          示範
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-5 py-2 rounded-full text-sm font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}

interface Props {
  sentences: FillInBlankItem[];
  vocabBank: Record<string, string>;
  onComplete: (score: number, total: number, firstTryResults?: QuestionResult[]) => void;
  storyId?: string | number;
  /**
   * #2848 — 先前存下的作答快照（DB 優先於 localStorage）。
   * 沒給就退回 localStorage，跟這個元件原本的行為一樣。
   */
  initialProgress?: SavedProgress | null;
  /**
   * #2848 — 每答一題回報一次。
   *
   * 這個 callback 之前不存在，是這一關進度存不進 DB 的根因：逐題作答只寫進
   * localStorage（`vocab_app_progress_<story>`），parent 完全不知情，所以
   * `VocabApplication` 送進 DB 的 patch 只有 `phase === 'done'` 的最終成績，
   * 以及 beforeunload 那個「一題答案都沒有」的 `{phase, partialAt}` 心跳。
   * 學生換一台裝置或清快取，整關從第 1 題重來。
   */
  onProgressChange?: (progress: SavedProgress) => void;
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

export interface SavedProgress {
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

const FillInBlankExercise: React.FC<Props> = ({
  sentences,
  vocabBank,
  onComplete,
  storyId,
  initialProgress,
  onProgressChange,
}) => {
  const bankEntries = Object.entries(vocabBank).sort(([a], [b]) => a.localeCompare(b));
  const { zhuyinActive, processZhuyin } = useZhuyin();
  // #2848: DB 快照優先，localStorage 只是離線 / 尚未載入時的 L1 快取。
  const savedProgress = initialProgress ?? loadProgress(storyId);

  // Onboarding state — gated by localStorage
  const [showCoach, setShowCoach] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(FILLBLANK_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });

  // Guided demo: step-by-step tooltips + animated tap on the correct option (visual only)
  const [demo, setDemo] = useState<DemoRuntime | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearDemoTimers = () => {
    demoTimersRef.current.forEach((id) => clearTimeout(id));
    demoTimersRef.current = [];
  };

  const scheduleDemoStep = (fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    demoTimersRef.current.push(id);
    return id;
  };

  // Clean up demo timers on unmount
  useEffect(() => () => clearDemoTimers(), []);

  const handleDismissCoach = () => {
    setShowCoach(false);
    try {
      localStorage.setItem(FILLBLANK_ONBOARDED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const [phase, setPhase] = useState<Phase>('exercise');
  const [retryMode, setRetryMode] = useState(savedProgress?.retryMode ?? false);
  const [retryIndices, setRetryIndices] = useState<number[]>(savedProgress?.pendingRetryIndices ?? []);
  const [currentIdx, setCurrentIdx] = useState(savedProgress?.currentIdx ?? 0);
  const [usedCodes, setUsedCodes] = useState<Set<string>>(() => new Set(savedProgress?.usedCodes ?? []));
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  // The word the student just picked — rendered INSIDE the sentence bracket
  // (correct → green, wrong → amber) so they always see the full sentence and
  // understand why an answer fits or doesn't, then continue / advance.
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
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
    const progress: SavedProgress = {
      currentIdx, usedCodes: Array.from(usedCodes), score, firstTryResults,
      pendingRetryIndices: retryIndices, retryMode,
    };
    if (storyId != null) saveProgress(storyId, progress);
    // #2848 — 同一份快照也往上送，讓它進得了 DB。跟 localStorage 綁在同一個
    // effect 是刻意的：兩邊存的是同一個東西，一起壞一起好，不會出現
    //「localStorage 有、DB 沒有」那種換裝置才發現的落差。
    onProgressChange?.(progress);
  }, [currentIdx, usedCodes, score, firstTryResults, retryIndices, retryMode, storyId, onProgressChange]);

  useEffect(() => {
    if (done && phase === 'exercise') setPhase('summary');
  }, [done, phase]);

  const currentSentence = !done ? activeSentences[currentIdx] : null;
  const currentOriginalIdx = retryMode ? retryIndices[currentIdx] : currentIdx;

  // #7 教授「選項呈現兩案」(featureFlag FILLBLANK_OPTION_MODE):
  //   'all'      → 全部選項，用過 grey out (default, 現狀)
  //   'disappear'→ 全部選項，用過直接移除 = 案 (b)
  //   'random4'  → 每題只 4 個（正解 + 3 確定性 decoy）= 案 (a) 降難度
  // random4 用 currentOriginalIdx 當 seed → 同題重選不會洗牌。
  const availableEntries = useMemo(() => {
    if (FILLBLANK_OPTION_MODE === 'disappear') {
      return bankEntries.filter(([code]) => !usedCodes.has(code));
    }
    if (FILLBLANK_OPTION_MODE === 'random4' && currentSentence) {
      const correct = currentSentence.answer;
      const correctEntry = bankEntries.find(([c]) => c === correct);
      const decoys = bankEntries.filter(([c]) => c !== correct);
      if (!correctEntry || decoys.length < 3) return bankEntries;
      const seed = (currentOriginalIdx + 1) * 7;
      // deterministic rotation → first 3 distinct decoys
      const rotated = decoys.map((_, i) => decoys[(i + seed) % decoys.length]);
      const out = rotated.slice(0, 3);
      out.splice(seed % (out.length + 1), 0, correctEntry); // stable, non-fixed slot
      return out;
    }
    return bankEntries; // 'all'
  }, [bankEntries, usedCodes, currentSentence, currentOriginalIdx]);

  /**
   * Guided demo on the real UI — tooltips + animated tap on the correct option.
   * Purely visual — does NOT submit an answer or affect scoring.
   */
  const handleDemo = () => {
    clearDemoTimers();
    if (!currentSentence) {
      handleDismissCoach();
      return;
    }
    handleDismissCoach();

    const targetCode = currentSentence.answer;
    setDemo({ step: 'read-sentence', targetCode });

    scheduleDemoStep(() => setDemo({ step: 'pick', targetCode }), 1400);
    scheduleDemoStep(() => setDemo({ step: 'click', targetCode }), 2800);
    scheduleDemoStep(() => setDemo({ step: 'success', targetCode }), 4200);
    scheduleDemoStep(() => setDemo(null), 5600);
  };

  // A10: selecting immediately evaluates — no separate confirm button
  function handleSelect(code: string) {
    if (feedback === 'correct') return; // already correct, guard early return (preserve A10 note)
    if (!currentSentence) return;

    // Drop the chosen word into the bracket — both correct AND wrong — so the
    // student reads the whole sentence with their pick in place.
    setSelectedCode(code);

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

      // A10: auto-advance after correct — hold ~1.2s so the student sees their
      // correct word sitting in the sentence bracket before moving on.
      setTimeout(() => {
        setCurrentIdx((i) => i + 1);
        setFeedback('idle');
        setSelectedCode(null);
        setFirstTryUsed(false);
        setHintText('');
      }, 1200);
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
    setSelectedCode(null);
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
    setSelectedCode(null);
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
    // Bug fix: blank placeholder may contain a VARIABLE number of full-width
    // spaces (e.g. G6-L22 uses 「（　　　）」= 3, L10 uses 「（　　）」= 2).
    // Match one-or-more spaces so the answer fills the in-sentence bracket
    // instead of falling through to the end when the count differs.
    const parts = sentence.split(/[（(][　\s]+[）)]/);
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
        // A11: single dashed underline blank (no ＿＿ glyphs — they doubled the line)
        <span
          className="inline-block border-b-2 border-dashed border-on-surface-variant/40 mx-1 min-w-[3.5em] pb-0.5"
          aria-label="填空"
        >
          {'\u3000'}
        </span>
      );

    return <>{zh(parts[0])}{blankContent}{zh(parts[1] ?? '')}</>;
  }

  // ── Summary screen ──────────────────────────────────────────────
  // #2834：header card + CTA row 抽到 `QuizCompletionScreen`（跟 ComprehensionMcqPage
  // 共用）。逐題清單留在這裡自己畫——這裡把正解嵌進句子裡的括號（`【word】`），跟
  // comprehension 用「正確：」另起一行不是同一種形狀，勉強共用會犧牲這個既有的
  // bracket-fill 呈現方式，見 QuizCompletionScreen.tsx 檔頭說明。
  if (phase === 'summary') {
    const firstTryScore = firstTryResults.filter((r) => r.firstTryCorrect).length;
    const firstTryTotal = sentences.length;
    const allCorrect = firstTryScore === firstTryTotal;
    const wrongCount = firstTryResults.filter((r) => !r.firstTryCorrect).length;

    return (
      <QuizCompletionScreen
        allCorrect={allCorrect}
        wrongCount={wrongCount}
        onRetryWrong={handleRetryWrong}
        onRetryAll={handleRetryAll}
        onNext={() => onComplete(firstTryScore, firstTryTotal, firstTryResults)}
        style={{ fontFamily: zhuyinFont }}
        toolboxMode={isToolboxMode()}
      >
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
      </QuizCompletionScreen>
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

        {/* Onboarding coach — shown first time or when student clicks help */}
        {showCoach && <OnboardingCoach onDismiss={handleDismissCoach} onDemo={handleDemo} />}

        {/* A11: per-question heading "第 N 題 / 共 M 題" */}
        {currentSentence && (
          <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wide">
            第 {questionNumber} 題 / 共 {total} 題
          </p>
        )}

        {/* Sentence card — A11: text-left + comfortable leading */}
        {currentSentence && (
          <>
            {demo?.step === 'read-sentence' && (
              <DemoBubble>① 先讀句子，想想空格要填什麼語詞</DemoBubble>
            )}
            <div className={`rounded-3xl p-6 md:p-8 transition-all duration-300 ${
              feedback === 'correct'
                ? 'bg-emerald-50 shadow-[0_8px_32px_rgba(16,185,129,0.15)]'
                : feedback === 'wrong'
                ? 'bg-amber-50 shadow-[0_4px_16px_rgba(217,119,6,0.1)]'
                : 'bg-surface-container-lowest shadow-editorial'
            } ${demo?.step === 'read-sentence' ? 'ring-4 ring-amber-300/50' : ''}`}>
              {/* A11: text-left (not text-center) */}
              <p className="text-xl md:text-2xl text-on-surface leading-[2.6rem] md:leading-[3.2rem] text-left">
                {renderSentence(currentSentence.sentence, selectedCode)}
              </p>
            </div>
          </>
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
          <>
            {demo?.step === 'pick' && (
              <DemoBubble>② 從下面選出最適合填進空格的語詞</DemoBubble>
            )}
            {(demo?.step === 'click' || demo?.step === 'success') && (
              <DemoBubble>
                {demo.step === 'click' ? '③ 點一下選擇答案' : '✓ 答對了！就是這樣玩'}
              </DemoBubble>
            )}
            <div className={`grid grid-cols-2 gap-3 transition-all duration-300 ${
              demo?.step === 'pick' ? 'ring-4 ring-amber-300/40 rounded-2xl p-1' : ''
            }`}>
              {availableEntries.map(([code, word]) => {
                const isUsedDecoy = usedCodes.has(code);
                const isDemoTarget = demo?.targetCode === code;
                const isWrongSelected =
                  feedback === 'wrong' &&
                  firstTryResults.length > 0 &&
                  firstTryResults[firstTryResults.length - 1]?.studentFirstAnswer === code &&
                  firstTryResults[firstTryResults.length - 1]?.sentenceIdx === currentOriginalIdx;

                let optionClass = 'border-surface-container-high bg-surface-container-lowest hover:border-on-surface-variant/30 hover:bg-surface-container-low active:scale-[0.97]';
                if (isDemoTarget && demo) {
                  if (demo.step === 'success') {
                    optionClass = 'border-emerald-400 bg-emerald-50 text-emerald-800 scale-[0.97]';
                  } else if (demo.step === 'click') {
                    optionClass = 'border-amber-400 bg-amber-50 text-amber-800 ring-4 ring-amber-300/60 scale-[0.97]';
                  }
                } else if (isUsedDecoy) {
                  optionClass = 'border-surface-container-high bg-surface-container-high/40 opacity-40 cursor-not-allowed';
                } else if (isWrongSelected) {
                  optionClass = 'border-amber-400 bg-amber-50 active:scale-[0.97]';
                }

                return (
                  <button
                    key={code}
                    onClick={() => !isUsedDecoy && !demo && handleSelect(code)}
                    disabled={isUsedDecoy || demo !== null}
                    aria-disabled={isUsedDecoy}
                    className={`relative rounded-2xl border-2 p-4 text-left flex items-center gap-3 transition-all min-h-[56px] ${optionClass}`}
                  >
                    {demo?.step === 'click' && isDemoTarget && (
                      <span
                        className="absolute -top-9 left-1/2 -translate-x-1/2 text-2xl animate-bounce pointer-events-none"
                        aria-hidden
                      >
                        {IS_TOUCH_DEVICE ? '👆' : '🖱️'}
                      </span>
                    )}
                    {demo?.step === 'success' && isDemoTarget && (
                      <span className="mr-1 text-emerald-600" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {FILLBLANK_SHOW_ABCD && (
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-headline font-black ${
                        isUsedDecoy
                          ? 'bg-surface-container-high text-on-surface-variant/40'
                          : isWrongSelected || (isDemoTarget && demo)
                          ? 'bg-amber-400 text-white'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}>
                        {code}
                      </span>
                    )}
                    <span className={`font-bold text-base ${
                      isUsedDecoy
                        ? 'text-on-surface-variant/40 line-through'
                        : isWrongSelected || (isDemoTarget && demo)
                        ? 'text-amber-700'
                        : 'text-on-surface'
                    }`}>
                      {zh(word)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* A10: no confirm button — selecting triggers immediate evaluation.
            Show a gentle "try again" nudge only when in wrong state so user knows to tap another option. */}
        {feedback === 'wrong' && currentSentence && (
          <p className="text-xs text-center text-on-surface-variant">
            點選其他選項繼續作答
          </p>
        )}

        {/* Show help button after onboarding is dismissed */}
        {!showCoach && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowCoach(true)}
              className="text-xs text-on-surface-variant/60 hover:text-on-surface-variant transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">help_outline</span>
              怎麼玩？
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default FillInBlankExercise;
