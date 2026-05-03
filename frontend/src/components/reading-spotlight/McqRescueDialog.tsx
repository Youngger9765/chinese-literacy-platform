/**
 * McqRescueDialog — AI-guided rescue modal for wrong MCQ answers.
 *
 * Triggered when a student answers an MCQ incorrectly. Runs a 5-step
 * SOP (林國源校長 + 5/1 expert meeting) to guide the student to the
 * correct answer using strategy-specific scaffolding.
 *
 * Phase 1: Text-only (voice tab reserved for Phase 2 / Issue #1340).
 *
 * Accessibility:
 *   - useFocusTrap: focus confined to modal while open
 *   - Esc / backdrop click closes the dialog
 *   - role="dialog" + aria-modal + aria-labelledby
 *
 * Issue #1387 — Phase 1 scaffold
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McqRescueContext {
  questionId: string;
  lessonId: string;
  wrongChoice: string;
  questionText: string;
  correctAnswer: string;
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
// Step labels (5 steps SOP)
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<number, string> = {
  1: '確認題意',
  2: '找線索',
  3: '復述',
  4: '選答案',
  5: '直接教學',
};

// ---------------------------------------------------------------------------
// ChatMessage subcomponent
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  role: 'ai' | 'student';
  text: string;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ role, text }) => {
  const isAi = role === 'ai';
  return (
    <div className={`flex ${isAi ? 'justify-start' : 'justify-end'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isAi
            ? 'bg-blue-50 text-blue-900 rounded-tl-sm border border-blue-100'
            : 'bg-gray-100 text-gray-800 rounded-tr-sm'
        }`}
      >
        {isAi && (
          <span className="block text-xs text-blue-500 font-medium mb-1">小語老師</span>
        )}
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

  useFocusTrap(dialogRef, isOpen);

  // Rescue session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [messages, setMessages] = useState<ChatMessageProps[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Start rescue session when dialog opens
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen || !context) return;

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
      setCurrentStep(1);
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
        setCurrentStep(res.current_step);
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

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !sessionId || isLoading || isTerminated || !token) return;

    setInputText('');
    setMessages((prev) => [...prev, { role: 'student', text }]);
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res: McqRescueRespondResponse = await mcqRescueRespond(token, {
        session_id: sessionId,
        student_text: text,
      });

      setCurrentStep(res.current_step);

      // Compose AI reply: feedback + follow-up question
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
        // Re-add user message on error? No — already displayed. Just show error.
      }
    } finally {
      setIsLoading(false);
    }
  }, [inputText, sessionId, isLoading, isTerminated, token, onComplete]);

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
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2
              id="mcq-rescue-title"
              className="text-base font-semibold text-gray-800"
            >
              AI 助教引導
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              沒關係，讓我們一起想想看
            </p>
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

        {/* 5-step progress bar */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((step) => {
              const isActive = step === currentStep;
              const isDone = step < currentStep;
              return (
                <React.Fragment key={step}>
                  <div className="flex flex-col items-center gap-0.5 flex-1">
                    <div
                      className={`w-full h-1.5 rounded-full transition-all ${
                        isDone
                          ? 'bg-green-400'
                          : isActive
                          ? 'bg-blue-400'
                          : 'bg-gray-200'
                      }`}
                    />
                    <span
                      className={`text-[10px] font-medium ${
                        isDone
                          ? 'text-green-600'
                          : isActive
                          ? 'text-blue-600'
                          : 'text-gray-400'
                      }`}
                    >
                      {STEP_LABELS[step]}
                    </span>
                  </div>
                  {step < 5 && (
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isDone ? 'bg-green-400' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {/* Voice tab placeholder — reserved for Phase 2 */}
          <div className="flex gap-2 mt-2">
            <button
              className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 rounded-full px-3 py-1 font-medium"
              disabled
            >
              {/* Text mode (active) */}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4H9v-4z" />
              </svg>
              文字模式
            </button>
            <button
              className="flex items-center gap-1 text-xs text-gray-400 rounded-full px-3 py-1 font-medium cursor-not-allowed"
              disabled
              title="語音模式 — Phase 2 敬請期待"
            >
              {/* Voice icon */}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              語音模式
              <span className="text-[9px] bg-gray-200 text-gray-500 rounded px-1">即將推出</span>
            </button>
          </div>
        </div>

        {/* Question context */}
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 shrink-0">
          <p className="text-xs text-amber-700 font-medium mb-0.5">你答錯的題目</p>
          <p className="text-sm text-amber-800 leading-snug line-clamp-2">{context.questionText}</p>
          <p className="text-xs text-amber-600 mt-1">你選了：{context.wrongChoice}</p>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-1"
          style={{ minHeight: 0 }}
        >
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} text={msg.text} />
          ))}
          {isLoading && (
            <div className="flex justify-start mb-3">
              <div className="bg-blue-50 border border-blue-100 rounded-2xl rounded-tl-sm px-4 py-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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

        {/* Input area */}
        {!isTerminated && (
          <div className="px-4 pb-4 pt-2 border-t border-gray-100 shrink-0">
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
      </div>
    </div>
  );
};

export default McqRescueDialog;
