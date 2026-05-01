/**
 * SentencePractice — Issue #109, #927, #1203
 *
 * After stroke order practice, students compose 2 sentences using each
 * practiced vocabulary word. AI validates grammar and word usage.
 *
 * Persistence (#1203):
 * - localStorage key `sentencePractice_progress_${scope}` stores wordStates,
 *   completedWords, currentWordIndex so refreshing preserves progress.
 * - When caller passes `saveStepProgressPatch`, DB is synced with step_data
 *   (mid-exercise) and markCompleted (when every word is finished).
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import {
  fetchExampleSentences,
  validateSentence,
  type ExampleSentence,
  type ExampleSentenceSource,
} from '../../services/learningApi';
import VoiceInputButton from '../ui/VoiceInputButton';

// ── Types ─────────────────────────────────────────────────────────────────

type SentenceStatus = 'idle' | 'loading' | 'correct' | 'incorrect';

interface SentenceEntry {
  text: string;
  status: SentenceStatus;
  feedback: string;
  suggestion: string;
}

interface WordPracticeState {
  exampleSentences: ExampleSentence[] | null;
  examplesLoading: boolean;
  examplesError: string;
  examplesSource: ExampleSentenceSource | null;
  sentences: [SentenceEntry, SentenceEntry];
  allCorrect: boolean;
}

function makeSentenceEntry(): SentenceEntry {
  return { text: '', status: 'idle', feedback: '', suggestion: '' };
}

function makeWordState(): WordPracticeState {
  return {
    exampleSentences: null, examplesLoading: false, examplesError: '', examplesSource: null,
    sentences: [makeSentenceEntry(), makeSentenceEntry()], allCorrect: false,
  };
}

function HighlightedSentence({ sentence, target }: { sentence: string; target: string }) {
  const parts = sentence.split(target);
  return (
    <span>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <span className="text-accent font-bold">{target}</span>}
        </React.Fragment>
      ))}
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────

interface SentencePracticeProps {
  practicedWords: string[];
  storyTitle: string;
  onFinish: () => void;
  onBack: () => void;
  inline?: boolean;
  /** Story id — used to scope localStorage key (#1203). */
  storyId?: string | number;
  /** Merge-based DB sync from LearningLayout (#1203). Optional — when absent,
   *  only localStorage persistence is active (good for /tools standalone). */
  saveStepProgressPatch?: (opts: {
    stepId: string;
    stepData: Record<string, unknown>;
    currentStep?: string | null;
    markCompleted?: boolean;
    immediate?: boolean;
  }) => void;
}

/* ------------------------------------------------------------------ */
/*  localStorage helpers (#1203)                                        */
/* ------------------------------------------------------------------ */

const STATE_STORAGE_PREFIX = 'sentencePractice_progress_';

interface SavedProgress {
  wordStates: Record<string, WordPracticeState>;
  completedWords: string[];
  currentWordIndex: number;
}

function storageKeyFor(storyId: string | number | undefined): string | null {
  if (storyId === undefined || storyId === null || storyId === '') return null;
  return scopedStepStorageKey(STATE_STORAGE_PREFIX, storyId);
}

function loadSaved(storyId: string | number | undefined): SavedProgress | null {
  const key = storageKeyFor(storyId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.wordStates &&
      Array.isArray(parsed.completedWords) &&
      typeof parsed.currentWordIndex === 'number'
    ) {
      return parsed as SavedProgress;
    }
  } catch { /* non-fatal */ }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────

const SentencePractice: React.FC<SentencePracticeProps> = ({
  practicedWords, storyTitle, onFinish, onBack, inline = false,
  storyId, saveStepProgressPatch,
}) => {
  const { token } = useAuth();
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;

  // Restore from localStorage (#1203) — lazy init so the disk read happens
  // exactly once even when loadSaved returns null (no re-reads on re-render).
  const [saved] = useState<SavedProgress | null>(() => loadSaved(storyId));

  const [currentWordIndex, setCurrentWordIndex] = useState<number>(() => {
    if (saved && saved.currentWordIndex < practicedWords.length) {
      return saved.currentWordIndex;
    }
    return 0;
  });

  const [wordStates, setWordStates] = useState<Record<string, WordPracticeState>>(() => {
    const init: Record<string, WordPracticeState> = {};
    for (const w of practicedWords) {
      const restored = saved?.wordStates?.[w];
      init[w] = restored ?? makeWordState();
    }
    return init;
  });

  const [completedWords, setCompletedWords] = useState<Set<string>>(() => {
    if (!saved) return new Set();
    const restored = new Set<string>();
    for (const w of saved.completedWords) {
      if (practicedWords.includes(w)) restored.add(w);
    }
    return restored;
  });
  const [pasteWarning, setPasteWarning] = useState(false);
  // Live transcript per sentence slot — cleared when user submits / word changes.
  // Index 0 = first sentence, 1 = second sentence. (#1327)
  const [liveTranscripts, setLiveTranscripts] = useState<[string, string]>(['', '']);
  const loadedWordsRef = useRef<Set<string>>(new Set());
  // True until the user actually interacts after mount. Prevents the DB sync
  // effect from firing with restored-only state and e.g. rolling `current_step`
  // back to 'sentence-practice' when the student has already moved on.
  const isRestoringRef = useRef(true);
  // Ref mirror of saveStepProgressPatch so the DB sync effect does NOT depend
  // on its identity. The prop is recreated on every LearningLayout render
  // (onProgressLoaded is inline), so including it in deps would make the
  // effect fire every render and PUT until the rate limiter kicks in (429).
  const savePatchRef = useRef(saveStepProgressPatch);
  useEffect(() => { savePatchRef.current = saveStepProgressPatch; }, [saveStepProgressPatch]);
  // IME composition guard (#1206): Enter during 注音選字 should not submit.
  // Only one input is focused at a time, so a single ref is sufficient.
  const isComposingRef = useRef(false);

  // Persist progress to localStorage whenever it changes (#1203).
  const storageKey = useMemo(() => storageKeyFor(storyId), [storyId]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const payload: SavedProgress = {
        wordStates,
        completedWords: Array.from(completedWords),
        currentWordIndex,
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* non-fatal */ }
  }, [storageKey, wordStates, completedWords, currentWordIndex]);

  // DB sync (#1203): mid-exercise patch on progress change; markCompleted when every word done.
  // Skip first fire so restored localStorage state doesn't clobber LearningLayout's
  // current_step (e.g. student already moved to vocab-definition and just revisits).
  // Uses savePatchRef (not the prop directly) to avoid re-running on every parent
  // render caused by unstable `saveStepProgressPatch` identity.
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    const patch = savePatchRef.current;
    if (!patch) return;
    const allDone =
      practicedWords.length > 0 && practicedWords.every((w) => completedWords.has(w));
    if (allDone) {
      patch({
        stepId: 'sentence-practice',
        currentStep: 'sentence-practice',
        markCompleted: true,
        immediate: true,
        stepData: {
          completed: true,
          completedAt: new Date().toISOString(),
          wordCount: practicedWords.length,
        },
      });
    } else if (completedWords.size > 0) {
      patch({
        stepId: 'sentence-practice',
        currentStep: 'sentence-practice',
        stepData: {
          completedWords: Array.from(completedWords),
          currentWordIndex,
          partialAt: new Date().toISOString(),
        },
      });
    }
  }, [completedWords, currentWordIndex, practicedWords]);

  const currentWord = practicedWords[currentWordIndex] ?? '';
  const currentState = wordStates[currentWord] ?? makeWordState();

  // Clear live transcript display whenever the active word changes (#1327).
  const prevWordRef = useRef(currentWord);
  useEffect(() => {
    if (prevWordRef.current !== currentWord) {
      prevWordRef.current = currentWord;
      setLiveTranscripts(['', '']);
    }
  }, [currentWord]);

  const loadExamples = useCallback(async () => {
    if (!currentWord || loadedWordsRef.current.has(currentWord)) return;
    // Skip API call if examples were restored from localStorage (#1203).
    if (currentState.exampleSentences !== null) {
      loadedWordsRef.current.add(currentWord);
      return;
    }
    loadedWordsRef.current.add(currentWord);
    setWordStates(prev => ({ ...prev, [currentWord]: { ...prev[currentWord], examplesLoading: true, examplesError: '' } }));
    try {
      const { sentences: examples, source } = await fetchExampleSentences(token ?? '', currentWord, storyTitle);
      setWordStates(prev => ({ ...prev, [currentWord]: { ...prev[currentWord], examplesLoading: false, exampleSentences: examples, examplesSource: source } }));
    } catch {
      loadedWordsRef.current.delete(currentWord);
      setWordStates(prev => ({ ...prev, [currentWord]: { ...prev[currentWord], examplesLoading: false, examplesError: '例句載入失敗，請稍後再試。' } }));
    }
  }, [currentWord, currentState.exampleSentences, storyTitle, token]);

  React.useEffect(() => { loadExamples(); }, [loadExamples]);

  const updateSentenceText = useCallback((sentenceIndex: 0 | 1, text: string) => {
    setWordStates(prev => {
      const state = prev[currentWord];
      const updated: [SentenceEntry, SentenceEntry] = [{ ...state.sentences[0] }, { ...state.sentences[1] }];
      updated[sentenceIndex] = { ...updated[sentenceIndex], text, status: 'idle', feedback: '', suggestion: '' };
      return { ...prev, [currentWord]: { ...state, sentences: updated } };
    });
  }, [currentWord]);

  const handleValidate = useCallback(async (sentenceIndex: 0 | 1) => {
    const sentence = currentState.sentences[sentenceIndex];
    if (!sentence.text.trim()) return;
    setWordStates(prev => {
      const state = prev[currentWord];
      const updated: [SentenceEntry, SentenceEntry] = [{ ...state.sentences[0] }, { ...state.sentences[1] }];
      updated[sentenceIndex] = { ...updated[sentenceIndex], status: 'loading' };
      return { ...prev, [currentWord]: { ...state, sentences: updated } };
    });
    try {
      const result = await validateSentence(token ?? '', currentWord, sentence.text.trim(), storyTitle);
      setWordStates(prev => {
        const state = prev[currentWord];
        const updated: [SentenceEntry, SentenceEntry] = [{ ...state.sentences[0] }, { ...state.sentences[1] }];
        updated[sentenceIndex] = { ...updated[sentenceIndex], status: result.is_correct ? 'correct' : 'incorrect', feedback: result.feedback, suggestion: result.suggestion };
        const bothCorrect = updated[0].status === 'correct' && updated[1].status === 'correct';
        return { ...prev, [currentWord]: { ...state, sentences: updated, allCorrect: bothCorrect } };
      });
    } catch {
      setWordStates(prev => {
        const state = prev[currentWord];
        const updated: [SentenceEntry, SentenceEntry] = [{ ...state.sentences[0] }, { ...state.sentences[1] }];
        updated[sentenceIndex] = { ...updated[sentenceIndex], status: 'incorrect', feedback: '評估失敗，請再試一次。', suggestion: '' };
        return { ...prev, [currentWord]: { ...state, sentences: updated } };
      });
    }
  }, [currentWord, currentState, storyTitle, token]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, idx: 0 | 1) => {
    // Skip Enter while IME is composing (e.g. 注音選字) — #1206.
    const nativeEvent = e.nativeEvent as KeyboardEvent;
    const isImeComposing =
      isComposingRef.current ||
      nativeEvent.isComposing ||
      nativeEvent.keyCode === 229;
    const text = currentState.sentences[idx].text;
    if (e.key === 'Enter' && !isImeComposing && text.trim()) {
      handleValidate(idx);
    }
  }, [currentState, handleValidate]);

  const handleCompleteCurrentWord = () => {
    setCompletedWords(prev => new Set(prev).add(currentWord));
    if (currentWordIndex < practicedWords.length - 1) setCurrentWordIndex(i => i + 1);
  };

  // ── No words ──────────────────────────────────────────────────────
  if (practicedWords.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">edit_note</span>
          <p className="text-on-surface-variant">沒有需要造句練習的詞語</p>
          <button onClick={onFinish} className="btn-immersive">
            繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
          </button>
        </div>
      </div>
    );
  }

  const allWordsDone = practicedWords.every(w => completedWords.has(w));
  const isCurrentDone = completedWords.has(currentWord);
  const currentAllCorrect = currentState.allCorrect;
  const progressPercent = practicedWords.length > 0 ? (completedWords.size / practicedWords.length) * 100 : 0;

  // ── Vertical word tab sidebar ──────────────────────────────────────
  const wordSidebar = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="material-symbols-outlined text-on-surface-variant text-lg">list_alt</span>
        <span className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">詞語列表</span>
      </div>
      {practicedWords.map((w, i) => {
        const done = completedWords.has(w);
        const active = i === currentWordIndex;
        return (
          <button
            key={w}
            onClick={() => setCurrentWordIndex(i)}
            className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-left transition-all ${
              active
                ? 'bg-accent text-white shadow-sm'
                : done
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-headline font-black ${
              active ? 'bg-white/20 text-white'
              : done ? 'bg-emerald-500 text-white'
              : 'bg-surface-container-high text-on-surface-variant'
            }`}>
              {done ? <span className="material-symbols-outlined text-sm">check</span> : i + 1}
            </span>
            <span className="font-bold text-base">{zh(w)}</span>
          </button>
        );
      })}
      {/* Progress */}
      <div className="mt-3 px-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-on-surface-variant">完成進度</span>
          <span className="text-xs font-headline font-bold text-on-surface-variant">{completedWords.size}/{practicedWords.length}</span>
        </div>
        <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </div>
  );

  // ── Word selector pills (for inline/mobile) ──────────────────────
  const wordPills = practicedWords.length > 1 && (
    <div className="flex flex-wrap gap-2 mb-4">
      {practicedWords.map((w, i) => {
        const done = completedWords.has(w);
        const active = i === currentWordIndex;
        return (
          <button
            key={w}
            onClick={() => setCurrentWordIndex(i)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-headline font-bold transition-all ${
              active
                ? 'bg-accent text-white shadow-sm'
                : done
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            {zh(w)}
            {done && <span className="material-symbols-outlined text-sm">check</span>}
          </button>
        );
      })}
    </div>
  );

  // ── Shared content renderer ───────────────────────────────────────
  function renderContent() {
    return (
      <div className="space-y-6">

        {/* Current word card */}
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 text-center">
          <p className="text-5xl font-bold text-accent leading-none mb-3">{zh(currentWord)}</p>
          <p className="text-sm text-on-surface-variant">
            用「{zh(currentWord)}」造兩個句子，讓 AI 幫你批改
          </p>
        </div>

        {/* Example sentences */}
        <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-accent text-xl">auto_stories</span>
            <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">AI 例句示範</span>
            {!currentState.examplesLoading && currentState.examplesSource && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                currentState.examplesSource === 'pregenerated' ? 'bg-accent/10 text-accent' : 'bg-tertiary-container/20 text-tertiary'
              }`}>
                {currentState.examplesSource === 'pregenerated' ? '預先生成' : 'AI 即時'}
              </span>
            )}
          </div>

          {currentState.examplesLoading && (
            <div className="flex items-center gap-2 text-sm text-on-surface-variant py-4">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              AI 正在生成例句...
            </div>
          )}

          {currentState.examplesError && (
            <div className="text-sm text-tertiary py-2">
              {currentState.examplesError}
              <button onClick={loadExamples} className="ml-2 text-accent underline font-bold">重試</button>
            </div>
          )}

          {currentState.exampleSentences && (
            <div className="space-y-3">
              {currentState.exampleSentences.map((ex, i) => (
                <div key={i} className="bg-surface-container-low rounded-2xl p-4">
                  <p className="text-base text-on-surface leading-relaxed">
                    <HighlightedSentence sentence={ex.sentence} target={currentWord} />
                  </p>
                  <p className="text-xs text-on-surface-variant mt-1.5">{ex.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Student sentence inputs */}
        {([0, 1] as const).map(idx => {
          const entry = currentState.sentences[idx];
          return (
            <div key={idx} className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-headline font-black ${
                  entry.status === 'correct' ? 'bg-emerald-500 text-white'
                  : entry.status === 'incorrect' ? 'bg-tertiary text-white'
                  : 'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {entry.status === 'correct' ? <span className="material-symbols-outlined text-sm">check</span>
                  : entry.status === 'incorrect' ? <span className="material-symbols-outlined text-sm">close</span>
                  : idx + 1}
                </span>
                <span className="text-sm font-headline font-bold text-on-surface-variant">第 {idx + 1} 句</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={entry.text}
                  onChange={e => updateSentenceText(idx, e.target.value)}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { isComposingRef.current = false; }}
                  onKeyDown={e => handleKeyDown(e, idx)}
                  onPaste={e => { e.preventDefault(); setPasteWarning(true); setTimeout(() => setPasteWarning(false), 3000); }}
                  onDrop={e => { e.preventDefault(); setPasteWarning(true); setTimeout(() => setPasteWarning(false), 3000); }}
                  onDragOver={e => e.preventDefault()}
                  disabled={entry.status === 'loading' || isCurrentDone}
                  placeholder={`用「${zh(currentWord)}」造一個句子…`}
                  className={`flex-1 rounded-2xl border-2 px-4 py-3 text-base outline-none transition-all ${
                    entry.status === 'correct' ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                    : entry.status === 'incorrect' ? 'border-tertiary/40 bg-tertiary-container/10 text-on-surface'
                    : 'border-surface-container-high bg-transparent focus:border-accent text-on-surface'
                  }`}
                />
                <VoiceInputButton
                  key={currentWord + String(idx)}
                  onTranscript={(text) => {
                    updateSentenceText(idx, text);
                    // Clear live display once final transcript is committed (#1327).
                    setLiveTranscripts(prev => {
                      const next: [string, string] = [prev[0], prev[1]];
                      next[idx] = '';
                      return next;
                    });
                  }}
                  onLiveTranscript={(text) => {
                    // Show interim transcript below the input field (#1327).
                    setLiveTranscripts(prev => {
                      const next: [string, string] = [prev[0], prev[1]];
                      next[idx] = text;
                      return next;
                    });
                  }}
                  disabled={entry.status === 'loading' || isCurrentDone}
                />
                <button
                  onClick={() => handleValidate(idx)}
                  disabled={!entry.text.trim() || entry.status === 'loading' || isCurrentDone}
                  className={`px-5 py-3 rounded-2xl text-sm font-headline font-bold transition-all active:scale-[0.97] shrink-0 ${
                    entry.status === 'loading' ? 'bg-surface-container-high text-on-surface-variant cursor-wait'
                    : entry.status === 'correct' ? 'bg-emerald-500 text-white'
                    : 'bg-accent hover:brightness-110 text-white disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  {entry.status === 'loading' ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : entry.status === 'correct' ? (
                    <span className="material-symbols-outlined text-lg">check</span>
                  ) : '批改'}
                </button>
              </div>

              {/* Live transcript display — shown while mic is active (#1327) */}
              {liveTranscripts[idx] && (
                <div className="mt-2 flex items-start gap-1.5 px-2">
                  <span className="material-symbols-outlined text-sm text-red-400 animate-pulse mt-0.5 shrink-0">mic</span>
                  <p className="text-sm text-on-surface-variant italic leading-snug">
                    {liveTranscripts[idx]}
                  </p>
                </div>
              )}

              {/* Feedback — font sizes bumped to text-base / text-sm (#1327) */}
              {(entry.status === 'correct' || entry.status === 'incorrect') && (
                <div className={`mt-3 rounded-2xl px-4 py-4 ${
                  entry.status === 'correct' ? 'bg-emerald-50' : 'bg-tertiary-container/10'
                }`}>
                  <div className="flex items-start gap-2">
                    <span className={`material-symbols-outlined text-xl mt-0.5 ${entry.status === 'correct' ? 'text-emerald-600' : 'text-tertiary'}`}>
                      {entry.status === 'correct' ? 'check_circle' : 'lightbulb'}
                    </span>
                    <div>
                      <p className={`text-base font-medium leading-relaxed ${entry.status === 'correct' ? 'text-emerald-800' : 'text-on-surface'}`}>{entry.feedback}</p>
                      {entry.suggestion && <p className="mt-1.5 text-sm text-on-surface-variant leading-relaxed">{entry.suggestion}</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Paste warning */}
        {pasteWarning && (
          <div className="rounded-2xl bg-tertiary-container/15 border border-tertiary/20 px-5 py-3 text-center animate-fade-in">
            <span className="text-sm text-tertiary font-medium">請用自己的話造句，不要複製貼上喔！</span>
          </div>
        )}

        {/* Word complete — advance */}
        {currentAllCorrect && !isCurrentDone && (
          <div className="bg-emerald-50 rounded-3xl p-6 text-center animate-fade-in">
            <span className="material-symbols-outlined text-3xl text-emerald-600 mb-2">celebration</span>
            <p className="text-lg font-headline font-bold text-emerald-700 mb-4">「{zh(currentWord)}」造句全部正確！</p>
            <button
              onClick={handleCompleteCurrentWord}
              className="h-12 px-8 rounded-full font-headline font-bold text-base text-white active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
            >
              {currentWordIndex < practicedWords.length - 1 ? '繼續下一個詞' : '完成所有造句'}
              <span className="material-symbols-outlined text-lg ml-1 align-middle">arrow_forward</span>
            </button>
          </div>
        )}

        {isCurrentDone && (
          <div className="bg-emerald-50 rounded-2xl px-5 py-3 text-center">
            <span className="text-sm font-medium text-emerald-700">
              <span className="material-symbols-outlined text-sm align-middle mr-1">check_circle</span>
              「{zh(currentWord)}」已完成
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Inline mode ───────────────────────────────────────────────────
  if (inline) {
    return <>{wordPills}{renderContent()}</>;
  }

  // ── Standalone mode — two-column: content left + word tabs right ──
  return (
    <div className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative">
      <div className="flex-1 min-h-0 px-4 md:px-6 py-6 md:py-8">
        <div className="w-full h-full flex gap-6">

          {/* Left: main content (scrollable) */}
          <div className="flex-1 min-w-0 overflow-y-auto pb-32 custom-scrollbar">
            {renderContent()}
          </div>

          {/* Right: vertical word tab sidebar */}
          {practicedWords.length > 1 && (
            <div className="hidden md:block w-48 lg:w-56 shrink-0 overflow-y-auto custom-scrollbar">
              {wordSidebar}
            </div>
          )}
        </div>

        {/* Mobile: horizontal pills (shown below top bar, above content) */}
        {practicedWords.length > 1 && (
          <div className="md:hidden absolute top-0 left-0 right-0 px-4 pt-4 pb-2 bg-surface z-10">
            {wordPills}
          </div>
        )}
      </div>

      {/* Fixed bottom CTA — only when all words done */}
      {allWordsDone && (
        <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto">
            <button onClick={onFinish}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
              繼續下一步
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
          </div>
        </div>
      )}

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b0ada6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #797770; }
      `}</style>
    </div>
  );
};

export default SentencePractice;
