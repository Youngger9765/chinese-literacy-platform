/**
 * useSentencePracticeState — extracted from SentencePractice.tsx (#1883)
 *
 * Pure utility functions + the stateful hook for word state transitions,
 * localStorage persistence, and DB sync.
 *
 * Exports tested by SentencePractice.test.ts:
 *   filterRestoredWords  — stale localStorage words are ignored
 *   shouldBlockEnterOnIme — IME composition guard for Enter key
 *   isAllWordsDone       — completion check before markCompleted fires
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import {
  fetchExampleSentences,
  validateSentence,
  type ExampleSentence,
  type ExampleSentenceSource,
} from '../../services/learningApi';

// ── Types ─────────────────────────────────────────────────────────────────

export type SentenceStatus = 'idle' | 'loading' | 'correct' | 'incorrect';

export interface SentenceEntry {
  text: string;
  status: SentenceStatus;
  feedback: string;
  suggestion: string;
}

export interface WordPracticeState {
  exampleSentences: ExampleSentence[] | null;
  examplesLoading: boolean;
  examplesError: string;
  examplesSource: ExampleSentenceSource | null;
  sentences: [SentenceEntry, SentenceEntry];
  allCorrect: boolean;
}

export function makeSentenceEntry(): SentenceEntry {
  return { text: '', status: 'idle', feedback: '', suggestion: '' };
}

export function makeWordState(): WordPracticeState {
  return {
    exampleSentences: null,
    examplesLoading: false,
    examplesError: '',
    examplesSource: null,
    sentences: [makeSentenceEntry(), makeSentenceEntry()],
    allCorrect: false,
  };
}

// ── localStorage helpers ───────────────────────────────────────────────────

export const STATE_STORAGE_PREFIX = 'sentencePractice_progress_';

export interface SavedProgress {
  wordStates: Record<string, WordPracticeState>;
  completedWords: string[];
  currentWordIndex: number;
}

export function storageKeyFor(storyId: string | number | undefined): string | null {
  if (storyId === undefined || storyId === null || storyId === '') return null;
  return scopedStepStorageKey(STATE_STORAGE_PREFIX, storyId);
}

export function loadSaved(storyId: string | number | undefined): SavedProgress | null {
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

// ── Pure utility functions (TDD-tested) ───────────────────────────────────

/**
 * Filter saved completed words against current practice list.
 * Stale words (no longer in current list) are silently ignored.
 * Returns an array (not Set) for easy serialization comparison.
 */
export function filterRestoredWords(
  savedCompletedWords: string[],
  currentPracticeWords: string[],
): string[] {
  return savedCompletedWords.filter((w) => currentPracticeWords.includes(w));
}

/**
 * Determine whether an Enter keypress should be blocked due to active
 * IME composition (e.g. 注音 candidate selection).
 *
 * Three signals to check:
 *   1. nativeEvent.isComposing (standard — Chrome/Firefox)
 *   2. nativeEvent.keyCode === 229 (legacy — some mobile browsers)
 *   3. composingRef — a React ref that tracks compositionstart/end events,
 *      needed for browsers where isComposing fires too late.
 */
export function shouldBlockEnterOnIme(opts: {
  isComposing: boolean;
  keyCode: number;
  composingRef?: boolean;
}): boolean {
  return opts.isComposing || opts.keyCode === 229 || (opts.composingRef ?? false);
}

/**
 * Return true only when every word in practicedWords has been added to
 * completedWords. An empty practicedWords list returns false (safety guard
 * against accidental markCompleted fires on mount).
 */
export function isAllWordsDone(
  practicedWords: string[],
  completedWords: Set<string>,
): boolean {
  return practicedWords.length > 0 && practicedWords.every((w) => completedWords.has(w));
}

// ── Hook ──────────────────────────────────────────────────────────────────

interface UseSentencePracticeStateOpts {
  practicedWords: string[];
  storyTitle: string;
  storyId?: string | number;
  token: string | null;
  saveStepProgressPatch?: (opts: {
    stepId: string;
    stepData: Record<string, unknown>;
    currentStep?: string | null;
    markCompleted?: boolean;
    immediate?: boolean;
  }) => void;
}

export interface SentencePracticeStateResult {
  currentWordIndex: number;
  setCurrentWordIndex: (i: number) => void;
  wordStates: Record<string, WordPracticeState>;
  completedWords: Set<string>;
  currentWord: string;
  currentState: WordPracticeState;
  isCurrentDone: boolean;
  allWordsDone: boolean;
  pasteWarning: boolean;
  setPasteWarning: (v: boolean) => void;
  liveTranscripts: [string, string];
  setLiveTranscripts: React.Dispatch<React.SetStateAction<[string, string]>>;
  voiceStopRef0: React.MutableRefObject<(() => void) | null>;
  voiceStopRef1: React.MutableRefObject<(() => void) | null>;
  isComposingRef: React.MutableRefObject<boolean>;
  loadExamples: () => Promise<void>;
  updateSentenceText: (sentenceIndex: 0 | 1, text: string) => void;
  handleValidate: (sentenceIndex: 0 | 1) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, idx: 0 | 1) => void;
  handleCompleteCurrentWord: () => void;
  /** Reset all state to initial — used by Toolbox retry. */
  resetAll: () => void;
  storageKey: string | null;
}

export function useSentencePracticeState({
  practicedWords,
  storyTitle,
  storyId,
  token,
  saveStepProgressPatch,
}: UseSentencePracticeStateOpts): SentencePracticeStateResult {
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
    const filtered = filterRestoredWords(saved.completedWords, practicedWords);
    return new Set(filtered);
  });

  const [pasteWarning, setPasteWarning] = useState(false);
  const [liveTranscripts, setLiveTranscripts] = useState<[string, string]>(['', '']);
  const voiceStopRef0 = useRef<(() => void) | null>(null);
  const voiceStopRef1 = useRef<(() => void) | null>(null);
  const loadedWordsRef = useRef<Set<string>>(new Set());
  const isRestoringRef = useRef(true);
  const savePatchRef = useRef(saveStepProgressPatch);
  useEffect(() => { savePatchRef.current = saveStepProgressPatch; }, [saveStepProgressPatch]);
  const isComposingRef = useRef(false);

  const storageKey = useMemo(() => storageKeyFor(storyId), [storyId]);

  // Persist to localStorage on state changes
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

  // DB sync — uses isAllWordsDone utility
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    const patch = savePatchRef.current;
    if (!patch) return;
    const allDone = isAllWordsDone(practicedWords, completedWords);
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

  // Clear live transcripts on word change
  const prevWordRef = useRef(currentWord);
  useEffect(() => {
    if (prevWordRef.current !== currentWord) {
      prevWordRef.current = currentWord;
      setLiveTranscripts(['', '']);
    }
  }, [currentWord]);

  const loadExamples = useCallback(async () => {
    if (!currentWord || loadedWordsRef.current.has(currentWord)) return;
    if (currentState.exampleSentences !== null) {
      loadedWordsRef.current.add(currentWord);
      return;
    }
    loadedWordsRef.current.add(currentWord);
    setWordStates(prev => ({
      ...prev,
      [currentWord]: { ...prev[currentWord], examplesLoading: true, examplesError: '' },
    }));
    try {
      const { sentences: examples, source } = await fetchExampleSentences(
        token ?? '', currentWord, storyTitle,
      );
      setWordStates(prev => ({
        ...prev,
        [currentWord]: { ...prev[currentWord], examplesLoading: false, exampleSentences: examples, examplesSource: source },
      }));
    } catch {
      loadedWordsRef.current.delete(currentWord);
      setWordStates(prev => ({
        ...prev,
        [currentWord]: { ...prev[currentWord], examplesLoading: false, examplesError: '例句載入失敗，請稍後再試。' },
      }));
    }
  }, [currentWord, currentState.exampleSentences, storyTitle, token]);

  const updateSentenceText = useCallback((sentenceIndex: 0 | 1, text: string) => {
    setWordStates(prev => {
      const state = prev[currentWord];
      const updated: [SentenceEntry, SentenceEntry] = [{ ...state.sentences[0] }, { ...state.sentences[1] }];
      updated[sentenceIndex] = { ...updated[sentenceIndex], text, status: 'idle', feedback: '', suggestion: '' };
      return { ...prev, [currentWord]: { ...state, sentences: updated } };
    });
  }, [currentWord]);

  const handleValidate = useCallback(async (sentenceIndex: 0 | 1) => {
    const stopRefs = [voiceStopRef0, voiceStopRef1] as const;
    stopRefs[sentenceIndex].current?.();
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
        updated[sentenceIndex] = {
          ...updated[sentenceIndex],
          status: result.is_correct ? 'correct' : 'incorrect',
          feedback: result.feedback,
          suggestion: result.suggestion,
        };
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
    const nativeEvent = e.nativeEvent as KeyboardEvent;
    const blocked = shouldBlockEnterOnIme({
      isComposing: nativeEvent.isComposing,
      keyCode: nativeEvent.keyCode,
      composingRef: isComposingRef.current,
    });
    const text = currentState.sentences[idx].text;
    if (e.key === 'Enter' && !blocked && text.trim()) {
      handleValidate(idx);
    }
  }, [currentState, handleValidate]);

  const handleCompleteCurrentWord = useCallback(() => {
    setCompletedWords(prev => new Set(prev).add(currentWord));
    if (currentWordIndex < practicedWords.length - 1) setCurrentWordIndex(i => i + 1);
  }, [currentWord, currentWordIndex, practicedWords.length]);

  const isCurrentDone = completedWords.has(currentWord);
  const allWordsDone = isAllWordsDone(practicedWords, completedWords);

  const resetAll = useCallback(() => {
    setCompletedWords(new Set());
    setCurrentWordIndex(0);
    setWordStates(() => {
      const init: Record<string, WordPracticeState> = {};
      for (const w of practicedWords) init[w] = makeWordState();
      return init;
    });
    setLiveTranscripts(['', '']);
    loadedWordsRef.current = new Set();
    if (storageKey) try { localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  }, [practicedWords, storageKey]);

  return {
    currentWordIndex,
    setCurrentWordIndex,
    wordStates,
    completedWords,
    currentWord,
    currentState,
    isCurrentDone,
    allWordsDone,
    pasteWarning,
    setPasteWarning,
    liveTranscripts,
    setLiveTranscripts,
    voiceStopRef0,
    voiceStopRef1,
    isComposingRef,
    loadExamples,
    updateSentenceText,
    handleValidate,
    handleKeyDown,
    handleCompleteCurrentWord,
    resetAll,
    storageKey,
  };
}
