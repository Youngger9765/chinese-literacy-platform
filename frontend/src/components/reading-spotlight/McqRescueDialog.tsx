/**
 * McqRescueDialog — AI-guided rescue modal triggered from MCQ practice.
 *
 * Backend runs a 5-step SOP (林國源校長 + 5/1 expert meeting) but the
 * stepper is intentionally hidden from students — Issue #1507 redesign
 * after 5/8 walkthrough showed the explicit progress bar felt like a
 * machine running through checkboxes rather than a conversation.
 *
 * Accessibility:
 *   - useFocusTrap: focus confined to modal while open
 *   - Esc / backdrop click closes the dialog
 *   - role="dialog" + aria-modal + aria-labelledby
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  mcqRescueRespond,
  mcqRescueStart,
  McqRescueRespondResponse,
  SessionExpiredError,
} from '../../services/learningApi';
import VoiceInputButton from '../ui/VoiceInputButton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McqRescueContext {
  questionId: string;
  lessonId: string;
  wrongChoice: string;             // option label, e.g. "A"
  wrongChoiceText?: string;        // option content, e.g. "自然環境"
  questionText: string;
  correctAnswer: string;           // option label, e.g. "B"
  correctAnswerText?: string;      // option content, e.g. "科技發展"
  options?: string[];              // all option contents in order (A, B, C, D)
  optionLabels?: string[];         // labels in order (defaults to A/B/C/D)
  strategyType?: string | null;
}

interface Props {
  isOpen: boolean;
  context: McqRescueContext | null;
  onClose: () => void;
  /** Called when rescue is complete (student passed or session terminated). */
  onComplete?: (passed: boolean) => void;
}

// ---------------------------------------------------------------------------
// Quick replies — generic phrases students can tap when stuck. The backend
// give-up detection already counts repeated "不知道" toward fallback teaching.
// ---------------------------------------------------------------------------

const QUICK_REPLIES = ['我不知道', '可以提示我嗎', '再說一次', '讓我想想'];

// ---------------------------------------------------------------------------
// ChatMessage subcomponent
// ---------------------------------------------------------------------------
//
// Visual notes (Issue #1507):
//   - The backend's 5-step SOP is intentionally NOT surfaced to students.
//     Young 5/8 meeting: "你引導的時候，不會把自己的步驟跟學生說。"
//   - AI bubble carries an avatar emoji + label "小語老師" so dialogue feels
//     like a person, not a stepper.

interface ChatMessageProps {
  role: 'ai' | 'student';
  text: string;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ role, text }) => {
  const isAi = role === 'ai';
  if (isAi) {
    return (
      <div className="flex items-start gap-2 mb-3">
        <span
          aria-hidden="true"
          className="shrink-0 w-7 h-7 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-base"
        >
          🦉
        </span>
        <div className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap bg-amber-50 text-amber-900 border border-amber-100">
          <span className="block text-xs text-amber-700 font-medium mb-1">
            小語老師
          </span>
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap bg-gray-100 text-gray-800">
        {text}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const McqRescueDialog: React.FC<Props> = ({
  isOpen,
  context,
  onClose,
  onComplete,
}) => {
  const { token } = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceStopRef = useRef<(() => void) | null>(null);

  useFocusTrap(dialogRef, isOpen);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageProps[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Tracks which questionId the local state was initialized for. If the
  // dialog closes and reopens for the same question, we keep the running
  // conversation instead of restarting (Young 5/9 feedback: closing the
  // window must not wipe the chat).
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Start (or resume) rescue session when dialog opens
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen || !context) return;
    // Reopening for the same question after close: keep history, skip start.
    if (initializedFor === context.questionId) return;

    let cancelled = false;

    const start = async () => {
      if (!token) {
        setErrorMsg('請先登入後再使用 AI 助教。');
        return;
      }
      setIsLoading(true);
      setErrorMsg(null);
      setMessages([]);
      setSessionId(null);
      setIsTerminated(false);
      setInputText('');

      try {
        const res = await mcqRescueStart(token, {
          question_id: context.questionId,
          lesson_id: context.lessonId,
          wrong_choice: context.wrongChoice,
          question_text: context.questionText,
          correct_answer: context.correctAnswer,
          strategy_type: context.strategyType ?? null,
        });
        if (cancelled) return;
        setSessionId(res.session_id);
        setInitializedFor(context.questionId);
        if (res.ai_first_message) {
          setMessages([{ role: 'ai', text: res.ai_first_message }]);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          setErrorMsg('登入已過期，請重新整理頁面後再試。');
        } else {
          setErrorMsg('AI 助教暫時無法連線，請稍後再試。');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    start();

    return () => {
      cancelled = true;
    };
    // Context identity is stable per-render; token dep covers auth changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, context?.questionId, token]);  // token from useAuth()

  // ---------------------------------------------------------------------------
  // Auto-scroll to bottom on new messages
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when loading completes
  useEffect(() => {
    if (!isLoading && sessionId && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading, sessionId]);

  // ---------------------------------------------------------------------------
  // Send student response
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !sessionId || isLoading || isTerminated || !token) return;

      setMessages((prev) => [...prev, { role: 'student', text }]);
      setIsLoading(true);
      setErrorMsg(null);

      try {
        const res: McqRescueRespondResponse = await mcqRescueRespond(token, {
          session_id: sessionId,
          student_text: text,
        });

        const aiText = [res.ai_feedback, res.next_question]
          .filter(Boolean)
          .join('\n')
          .trim();

        if (aiText) {
          setMessages((prev) => [...prev, { role: 'ai', text: aiText }]);
        }

        if (res.should_terminate) {
          setIsTerminated(true);
          const passed = res.should_advance && res.current_step <= 4;
          onComplete?.(passed);
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          setErrorMsg('登入已過期，請重新整理頁面後再試。');
        } else {
          setErrorMsg('AI 助教暫時無法回應，請稍後再試。');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, isLoading, isTerminated, token, onComplete],
  );

  const handleSend = useCallback(() => {
    voiceStopRef.current?.();
    const text = inputText;
    setInputText('');
    sendMessage(text);
  }, [inputText, sendMessage]);

  const handleQuickReply = useCallback(
    (reply: string) => {
      sendMessage(reply);
    },
    [sendMessage],
  );

  // ---------------------------------------------------------------------------
  // Keyboard handler
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSend, onClose],
  );

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // ---------------------------------------------------------------------------
  // Render guard
  // ---------------------------------------------------------------------------

  if (!isOpen || !context) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
      aria-hidden="false"
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcq-rescue-title"
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ height: '90vh' }}
      >
        {/* Header — friendly, no SOP scaffolding visible */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl">🦉</span>
            <h2
              id="mcq-rescue-title"
              className="text-base font-semibold text-gray-800"
            >
              小語老師
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="關閉"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — left: question + answers; right: chat. Stacks on mobile. */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* Left: question + all four options (wrong tinted red, correct tinted green) */}
          <aside className="md:w-2/5 md:border-r border-gray-100 px-5 py-4 bg-gray-50 shrink-0 md:overflow-y-auto">
            <p className="text-xs text-gray-500 font-medium mb-1">剛才的題目</p>
            <p className="text-sm text-gray-800 leading-relaxed mb-4 whitespace-pre-wrap">
              {context.questionText}
            </p>

            <div className="flex flex-col gap-2">
              {(context.options ?? []).map((optText, idx) => {
                const label = context.optionLabels?.[idx] ?? String.fromCharCode(65 + idx);
                const isCorrect = label === context.correctAnswer;
                const isWrong = label === context.wrongChoice;

                let cardClass =
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-relaxed ';
                let badgeClass =
                  'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold border ';
                let textClass = '';
                let suffix: React.ReactNode = null;

                if (isCorrect) {
                  cardClass += 'border-green-300 bg-green-50 text-green-900';
                  badgeClass += 'border-green-500 text-green-700';
                  textClass = 'font-medium';
                  suffix = <span className="ml-auto text-green-600 text-base shrink-0">✓</span>;
                } else if (isWrong) {
                  cardClass += 'border-red-300 bg-red-50 text-red-900';
                  badgeClass += 'border-red-500 text-red-700';
                  textClass = 'line-through';
                  suffix = <span className="ml-auto text-red-500 text-base shrink-0">✗</span>;
                } else {
                  cardClass += 'border-gray-200 bg-white text-gray-600';
                  badgeClass += 'border-gray-300 text-gray-500';
                }

                return (
                  <div key={label} className={cardClass}>
                    <span className={badgeClass}>{label}</span>
                    <span className={textClass}>{optText}</span>
                    {suffix}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Right: chat + input */}
          <section className="flex flex-col flex-1 min-h-0 min-w-0">
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-1"
              style={{ minHeight: 0 }}
            >
              {messages.map((msg, i) => (
                <ChatMessage key={i} role={msg.role} text={msg.text} />
              ))}
              {isLoading && (
                <div className="flex items-start gap-2 mb-3">
                  <span aria-hidden="true" className="shrink-0 w-7 h-7 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-base">
                    🦉
                  </span>
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl rounded-tl-sm px-4 py-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              {errorMsg && (
                <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2 border border-red-100">
                  {errorMsg}
                </div>
              )}
              {isTerminated && (
                <div className="bg-green-50 text-green-800 text-sm rounded-lg px-4 py-3 border border-green-100 text-center">
                  <p className="font-medium">引導結束</p>
                  <p className="text-xs text-green-600 mt-0.5">你可以關閉這個視窗繼續作答</p>
                  <button
                    onClick={onClose}
                    className="mt-2 bg-green-500 text-white text-xs rounded-full px-4 py-1.5 hover:bg-green-600 transition-colors"
                  >
                    繼續
                  </button>
                </div>
              )}
            </div>

            {/* Quick replies — generic phrases for stuck students */}
            {!isTerminated && sessionId && (
              <div className="px-4 pt-2 pb-1 border-t border-gray-100 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      onClick={() => handleQuickReply(reply)}
                      disabled={isLoading}
                      className="text-xs rounded-full border border-amber-200 bg-amber-50 text-amber-800 px-3 py-1 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input area */}
            {!isTerminated && (
              <div className="px-4 pb-4 pt-2 shrink-0">
                <div className="flex gap-2 items-center">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value.slice(0, 500))}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading || !sessionId}
                    placeholder={sessionId ? '輸入你的想法...' : '正在連接 AI 助教...'}
                    className="flex-1 text-sm rounded-xl border border-gray-200 px-4 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-400 transition-colors"
                    maxLength={500}
                    aria-label="回答輸入框"
                  />
                  <VoiceInputButton
                    onTranscript={(text) => setInputText(text.slice(0, 500))}
                    lang="zh-TW"
                    disabled={isLoading || !sessionId}
                    size="sm"
                    stopRef={voiceStopRef}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputText.trim() || isLoading || !sessionId || isTerminated}
                    className="shrink-0 bg-blue-500 text-white rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="送出回答"
                  >
                    送出
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5 text-right">
                  {inputText.length}/500
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default McqRescueDialog;
