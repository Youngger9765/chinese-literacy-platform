/**
 * SentencePractice — Issue #109
 *
 * After stroke order practice, students compose 2 sentences using each
 * practiced vocabulary character. AI validates grammar and word usage.
 */
import React, { useState, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Types ─────────────────────────────────────────────────────────────────

interface ExampleSentence {
  sentence: string;
  explanation: string;
}

type ExampleSentenceSource = 'pregenerated' | 'ai';

type SentenceStatus = 'idle' | 'loading' | 'correct' | 'incorrect';

interface SentenceEntry {
  text: string;
  status: SentenceStatus;
  feedback: string;
  suggestion: string;
}

interface CharacterPracticeState {
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

function makeCharState(): CharacterPracticeState {
  return {
    exampleSentences: null,
    examplesLoading: false,
    examplesError: '',
    examplesSource: null,
    sentences: [makeSentenceEntry(), makeSentenceEntry()],
    allCorrect: false,
  };
}

// ── API helpers ───────────────────────────────────────────────────────────

interface ExampleSentencesApiResponse {
  sentences: ExampleSentence[];
  source: ExampleSentenceSource;
}

async function fetchExampleSentences(
  character: string,
  storyTitle: string,
  token: string | null,
): Promise<ExampleSentencesApiResponse> {
  const res = await fetch(`${API_BASE}/api/learning/sentence-practice/example-sentences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ character, story_title: storyTitle }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    sentences: data.sentences as ExampleSentence[],
    source: (data.source ?? 'ai') as ExampleSentenceSource,
  };
}

async function validateSentence(
  character: string,
  studentSentence: string,
  storyTitle: string,
  token: string | null,
): Promise<{ is_correct: boolean; feedback: string; suggestion: string }> {
  const res = await fetch(`${API_BASE}/api/learning/sentence-practice/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      character,
      student_sentence: studentSentence,
      story_title: storyTitle,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Highlight target character in a sentence ──────────────────────────────

function HighlightedSentence({ sentence, target }: { sentence: string; target: string }) {
  const parts = sentence.split(target);
  return (
    <span>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="text-accent font-bold underline underline-offset-2">{target}</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────

interface SentencePracticeProps {
  /** Characters the student completed stroke order practice for */
  practicedChars: string[];
  storyTitle: string;
  onFinish: () => void;
  onBack: () => void;
  /** When true, renders as an inline tab panel (no outer wrapper, no tab bar, no bottom actions bar) */
  inline?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────

const SentencePractice: React.FC<SentencePracticeProps> = ({
  practicedChars,
  storyTitle,
  onFinish,
  onBack,
  inline = false,
}) => {
  const { token } = useAuth();
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [charStates, setCharStates] = useState<Record<string, CharacterPracticeState>>(() => {
    const init: Record<string, CharacterPracticeState> = {};
    for (const ch of practicedChars) {
      init[ch] = makeCharState();
    }
    return init;
  });
  const [completedChars, setCompletedChars] = useState<Set<string>>(new Set());
  const [pasteWarning, setPasteWarning] = useState(false);

  // Tracks characters that have been loaded or are currently loading,
  // avoiding circular dependency on charStates inside the loadExamples callback.
  const loadedCharsRef = useRef<Set<string>>(new Set());

  const currentChar = practicedChars[currentCharIndex] ?? '';
  const currentState = charStates[currentChar] ?? makeCharState();

  // ── Load example sentences for current character ──────────────────────

  const loadExamples = useCallback(async () => {
    if (!currentChar) return;
    // Use ref instead of charStates to avoid adding charStates as a dependency
    // (which would cause an infinite loop: error → setCharStates → new charStates
    //  → new loadExamples → useEffect fires → loadExamples called again → 429)
    if (loadedCharsRef.current.has(currentChar)) return;

    loadedCharsRef.current.add(currentChar);

    setCharStates(prev => ({
      ...prev,
      [currentChar]: { ...prev[currentChar], examplesLoading: true, examplesError: '' },
    }));

    try {
      const { sentences: examples, source } = await fetchExampleSentences(currentChar, storyTitle, token);
      setCharStates(prev => ({
        ...prev,
        [currentChar]: {
          ...prev[currentChar],
          examplesLoading: false,
          exampleSentences: examples,
          examplesSource: source,
        },
      }));
    } catch {
      // Remove from ref so the retry button can re-attempt
      loadedCharsRef.current.delete(currentChar);
      setCharStates(prev => ({
        ...prev,
        [currentChar]: {
          ...prev[currentChar],
          examplesLoading: false,
          examplesError: '例句載入失敗，請稍後再試。',
        },
      }));
    }
  }, [currentChar, storyTitle, token]);

  // Auto-load examples when we navigate to a character
  React.useEffect(() => {
    loadExamples();
  }, [loadExamples]);

  // ── Update sentence text ──────────────────────────────────────────────

  const updateSentenceText = useCallback(
    (sentenceIndex: 0 | 1, text: string) => {
      setCharStates(prev => {
        const state = prev[currentChar];
        const updated: [SentenceEntry, SentenceEntry] = [
          { ...state.sentences[0] },
          { ...state.sentences[1] },
        ];
        updated[sentenceIndex] = { ...updated[sentenceIndex], text, status: 'idle', feedback: '', suggestion: '' };
        return { ...prev, [currentChar]: { ...state, sentences: updated } };
      });
    },
    [currentChar],
  );

  // ── Validate a sentence ──────────────────────────────────────────────

  const handleValidate = useCallback(
    async (sentenceIndex: 0 | 1) => {
      const sentence = currentState.sentences[sentenceIndex];
      if (!sentence.text.trim()) return;

      // Set loading state
      setCharStates(prev => {
        const state = prev[currentChar];
        const updated: [SentenceEntry, SentenceEntry] = [
          { ...state.sentences[0] },
          { ...state.sentences[1] },
        ];
        updated[sentenceIndex] = { ...updated[sentenceIndex], status: 'loading' };
        return { ...prev, [currentChar]: { ...state, sentences: updated } };
      });

      try {
        const result = await validateSentence(currentChar, sentence.text.trim(), storyTitle, token);
        setCharStates(prev => {
          const state = prev[currentChar];
          const updated: [SentenceEntry, SentenceEntry] = [
            { ...state.sentences[0] },
            { ...state.sentences[1] },
          ];
          updated[sentenceIndex] = {
            ...updated[sentenceIndex],
            status: result.is_correct ? 'correct' : 'incorrect',
            feedback: result.feedback,
            suggestion: result.suggestion,
          };
          const bothCorrect = updated[0].status === 'correct' && updated[1].status === 'correct';
          return {
            ...prev,
            [currentChar]: { ...state, sentences: updated, allCorrect: bothCorrect },
          };
        });
      } catch {
        setCharStates(prev => {
          const state = prev[currentChar];
          const updated: [SentenceEntry, SentenceEntry] = [
            { ...state.sentences[0] },
            { ...state.sentences[1] },
          ];
          updated[sentenceIndex] = {
            ...updated[sentenceIndex],
            status: 'incorrect',
            feedback: '評估失敗，請再試一次。',
            suggestion: '',
          };
          return { ...prev, [currentChar]: { ...state, sentences: updated } };
        });
      }
    },
    [currentChar, currentState, storyTitle],
  );

  // ── Navigation ────────────────────────────────────────────────────────

  const handleCompleteCurrentChar = () => {
    setCompletedChars(prev => new Set(prev).add(currentChar));
    if (currentCharIndex < practicedChars.length - 1) {
      setCurrentCharIndex(i => i + 1);
    }
  };

  const handleFinish = () => {
    onFinish();
  };

  // ── Early exit: no practiced chars ───────────────────────────────────

  if (practicedChars.length === 0) {
    if (inline) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-12">
          <p className="text-gray-500 text-sm">沒有需要造句練習的生字。</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col bg-amber-50 overflow-hidden">
        <div className="h-9 bg-white border-b border-gray-200 flex items-center px-4 text-xs text-gray-600">
          {storyTitle} — 造句練習
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
          <p className="text-gray-500 text-sm mb-6">沒有需要造句練習的生字。</p>
          <button
            onClick={onFinish}
            className="px-6 py-2.5 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95"
          >
            繼續
          </button>
        </div>
      </div>
    );
  }

  const allCharsDone = practicedChars.every(ch => completedChars.has(ch));
  const isCurrentDone = completedChars.has(currentChar);
  const currentAllCorrect = currentState.allCorrect;

  const innerContent = (
    <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              造句練習
              <span className="ml-3 text-4xl text-accent">{currentChar}</span>
            </h2>
            <p className="text-sm text-gray-600">
              用「{currentChar}」造兩個句子，讓 AI 幫你批改。
            </p>
          </div>

          {/* Example sentences panel */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">AI 例句示範</span>
              {!currentState.examplesLoading && currentState.examplesSource && (
                <span className={[
                  'text-[10px] font-medium px-1.5 py-0.5 rounded',
                  currentState.examplesSource === 'pregenerated'
                    ? 'bg-blue-50 text-blue-500'
                    : 'bg-purple-50 text-purple-500',
                ].join(' ')}>
                  {currentState.examplesSource === 'pregenerated' ? '預先生成' : 'AI 即時生成'}
                </span>
              )}
            </div>

            {currentState.examplesLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                AI 正在生成例句...
              </div>
            )}

            {currentState.examplesError && (
              <div className="text-sm text-red-600">
                {currentState.examplesError}
                <button onClick={loadExamples} className="ml-2 text-accent underline">重試</button>
              </div>
            )}

            {currentState.exampleSentences && (
              <div className="space-y-3">
                {currentState.exampleSentences.map((ex, i) => (
                  <div key={i} className="bg-amber-50 rounded-xl p-3">
                    <p className="text-base text-gray-800 leading-relaxed">
                      <HighlightedSentence sentence={ex.sentence} target={currentChar} />
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{ex.explanation}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Student sentence inputs */}
          <div className="space-y-4">
            {([0, 1] as const).map(idx => {
              const entry = currentState.sentences[idx];
              return (
                <div key={idx} className="bg-white rounded-2xl border border-gray-200 p-4">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">
                    第 {idx + 1} 句
                  </label>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={entry.text}
                      onChange={e => updateSentenceText(idx, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && entry.text.trim()) {
                          handleValidate(idx);
                        }
                      }}
                      onPaste={e => {
                        e.preventDefault();
                        setPasteWarning(true);
                        setTimeout(() => setPasteWarning(false), 3000);
                      }}
                      disabled={entry.status === 'loading' || isCurrentDone}
                      placeholder={`用「${currentChar}」造一個句子…`}
                      className={[
                        'flex-1 rounded-xl border px-3 py-2 text-base outline-none transition-all',
                        entry.status === 'correct'
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                          : entry.status === 'incorrect'
                            ? 'border-red-300 bg-red-50 text-red-900'
                            : 'border-gray-200 bg-gray-50 focus:border-accent focus:bg-white text-gray-800',
                      ].join(' ')}
                    />
                    <button
                      onClick={() => handleValidate(idx)}
                      disabled={!entry.text.trim() || entry.status === 'loading' || isCurrentDone}
                      className={[
                        'px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95',
                        entry.status === 'loading'
                          ? 'bg-gray-200 text-gray-500 cursor-wait'
                          : entry.status === 'correct'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-accent hover:bg-accent-hover text-white disabled:opacity-40 disabled:cursor-not-allowed',
                      ].join(' ')}
                    >
                      {entry.status === 'loading' ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : entry.status === 'correct' ? '通過' : '批改'}
                    </button>
                  </div>

                  {/* Feedback */}
                  {(entry.status === 'correct' || entry.status === 'incorrect') && (
                    <div className={[
                      'mt-3 rounded-xl px-3 py-2 text-sm',
                      entry.status === 'correct'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-red-50 text-red-800',
                    ].join(' ')}>
                      <p className="font-medium">{entry.feedback}</p>
                      {entry.suggestion && (
                        <p className="mt-1 text-xs opacity-80">{entry.suggestion}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Paste warning (#928) */}
          {pasteWarning && (
            <p className="text-sm text-amber-600 text-center animate-pulse">
              請用自己的話造句，不要複製貼上喔！
            </p>
          )}

          {/* Completion message for current char */}
          {currentAllCorrect && !isCurrentDone && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
              <p className="text-emerald-800 font-bold text-lg">「{currentChar}」造句全部正確！</p>
              {currentCharIndex < practicedChars.length - 1 ? (
                <button
                  onClick={handleCompleteCurrentChar}
                  className="mt-3 px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all active:scale-95"
                >
                  繼續下一個字
                </button>
              ) : (
                <button
                  onClick={() => { handleCompleteCurrentChar(); }}
                  className="mt-3 px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all active:scale-95"
                >
                  完成所有造句
                </button>
              )}
            </div>
          )}

          {isCurrentDone && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 text-center">
              <p className="text-emerald-700 text-sm font-medium">「{currentChar}」已完成</p>
            </div>
          )}

    </div>
  );

  // Inline mode: render content directly inside VocabPractice's scroll area (no outer wrapper, no tab bar, no bottom bar)
  if (inline) {
    return (
      <>
        {/* Character tab nav — shown inline above content */}
        {practicedChars.length > 1 && (
          <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex flex-wrap gap-2">
            {practicedChars.map((ch, i) => {
              const done = completedChars.has(ch);
              const active = i === currentCharIndex;
              return (
                <button
                  key={ch}
                  onClick={() => setCurrentCharIndex(i)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                    active
                      ? 'bg-accent text-white shadow'
                      : done
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  ].join(' ')}
                >
                  {ch}
                  {done && (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {innerContent}
      </>
    );
  }

  // Standalone mode: full-page layout with tab bar and bottom actions
  return (
    <div className="flex-1 flex flex-col bg-amber-50 overflow-hidden" style={{ fontFamily: "'Iansui', 'Noto Sans TC', sans-serif" }}>

      {/* Tab bar */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
        <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800 gap-2">
          {storyTitle} — 造句練習
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-500">
          {currentCharIndex + 1} / {practicedChars.length} 字
        </span>
      </div>

      {/* Character tab nav */}
      {practicedChars.length > 1 && (
        <div className="bg-white border-b border-gray-100 px-4 py-2 flex gap-2 overflow-x-auto shrink-0">
          {practicedChars.map((ch, i) => {
            const done = completedChars.has(ch);
            const active = i === currentCharIndex;
            return (
              <button
                key={ch}
                onClick={() => setCurrentCharIndex(i)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-accent text-white shadow'
                    : done
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                {ch}
                {done && (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {innerContent}
      </div>

      {/* Bottom actions */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-full text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          回到生字練習
        </button>
        <button
          onClick={handleFinish}
          className="px-6 py-2.5 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2"
        >
          {allCharsDone ? '完成，查看報告' : '跳過，查看報告'}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

    </div>
  );
};

export default SentencePractice;
