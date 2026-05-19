/**
 * FloatingAIHelper — Floating AI chat assistant button + popup window (#929)
 *
 * Replaces the removed AI dialogue tab from ComprehensionChat.
 * Students can ask questions about the lesson text via this floating helper.
 * Uses the existing /api/comprehension/chat endpoint for AI responses.
 */
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { sendComprehensionChat, SessionExpiredError } from '../../services/learningApi';
import { useAuth } from '../../contexts/AuthContext';
import VoiceInputButton from '../ui/VoiceInputButton';

interface FloatingAIHelperProps {
  storyTitle: string;
  storyText: string;
  dbSessionId?: number;
}

type HelperMessage =
  | { role: 'ai'; text: string }
  | { role: 'student'; text: string };

// #1707: Young 5/19 — hide AI helper globally until UX is reworked.
// Flip back to true to re-enable everywhere without touching call sites.
const FLOATING_AI_HELPER_ENABLED = false;

const FloatingAIHelper: React.FC<FloatingAIHelperProps> = ({
  storyTitle,
  storyText,
  dbSessionId,
}) => {
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<HelperMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() =>
    dbSessionId ? `helper-${dbSessionId}` : `helper-${crypto.randomUUID()}`
  );
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    const studentMsg: HelperMessage = { role: 'student', text };
    setMessages(prev => [...prev, studentMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      const result = await sendComprehensionChat({
        sessionId,
        storyTitle,
        storyText,
        studentAnswer: text,
        dbSessionId,
        token: token ?? undefined,
      });

      const aiText = result.feedback || result.question || '我不太確定怎麼回答，請再試一次';
      setMessages(prev => [...prev, { role: 'ai', text: aiText }]);
    } catch (err) {
      const fallback = err instanceof SessionExpiredError
        ? '對話已過期，請重新提問'
        : '暫時無法回應，請稍後再試';
      setMessages(prev => [...prev, { role: 'ai', text: fallback }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputText, isLoading, sessionId, storyTitle, storyText, dbSessionId, token]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as KeyboardEvent;
    const isImeComposing = isComposingRef.current || e.isComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229;
    if (e.key === 'Enter' && !e.shiftKey && !isImeComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!FLOATING_AI_HELPER_ENABLED) return null;

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
          isOpen ? 'bg-gray-500 hover:bg-gray-600' : 'bg-accent hover:bg-accent-hover'
        }`}
        title={isOpen ? '關閉 AI 小助手' : '打開 AI 小助手'}
      >
        {isOpen ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat popup */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 max-h-[28rem] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="shrink-0 bg-accent px-4 py-3 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">AI</span>
            </div>
            <span className="text-white text-sm font-semibold">AI 小助手</span>
            <span className="text-white/70 text-xs ml-auto">有問題就問我</span>
          </div>

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 bg-gray-50">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-8">
                <p>對課文有疑問嗎？</p>
                <p className="mt-1">輸入你的問題，AI 會幫你解答</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'student' ? 'flex-row-reverse' : ''}`}>
                {msg.role === 'ai' && (
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                    <span className="text-white text-[8px] font-bold">AI</span>
                  </div>
                )}
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'ai'
                    ? 'bg-white border border-gray-200 text-gray-800'
                    : 'bg-accent text-white'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">AI</span>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-gray-200 p-2 flex gap-2 items-end bg-white">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              placeholder="輸入問題…"
              rows={1}
              disabled={isLoading}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent resize-none disabled:opacity-50"
            />
            <VoiceInputButton
              onTranscript={(text) => setInputText(text)}
              disabled={isLoading}
              size="sm"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isLoading}
              className="flex-shrink-0 w-9 h-9 rounded-lg bg-accent hover:bg-accent-hover disabled:bg-gray-300 text-white flex items-center justify-center transition-all active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingAIHelper;
