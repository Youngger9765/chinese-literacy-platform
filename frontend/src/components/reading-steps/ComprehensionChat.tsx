import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story, ReadingAttempt, ComprehensionResult } from '../../types';
import { sendComprehensionChat, ChatResponse, SessionExpiredError } from '../../services/api';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import { useIsMobile } from '../../hooks/useIsMobile';
import { getEncouragementMessage } from '../../utils/encouragement';
import { useAuth } from '../../contexts/AuthContext';

interface ComprehensionChatProps {
  story: Story;
  attempt: ReadingAttempt;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: (result: ComprehensionResult) => void;
  onBack: () => void;
  /** DB LearningSession integer ID — when provided, dialogue turns are persisted (Issue #242) */
  dbSessionId?: number;
}

type ChatMessage =
  | { role: 'ai'; text: string }
  | { role: 'student'; text: string }
  | { role: 'feedback'; text: string; understood: boolean; encouragement?: string };

const ComprehensionChat: React.FC<ComprehensionChatProps> = ({
  story,
  attempt,
  rightPanelWidth,
  onPanelWidthChange,
  onFinish,
  onBack,
  dbSessionId,
}) => {
  const { token } = useAuth();
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);

  // Mobile responsive
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<'story' | 'chat'>('chat');

  // Server-driven session state
  const [sessionId] = useState(() => crypto.randomUUID());
  const [understoodCount, setUnderstoodCount] = useState(0);
  const [requiredCount, setRequiredCount] = useState(3);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const [highlightedParagraph, setHighlightedParagraph] = useState<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initializedRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(384);

  const zhuyinActive = zhuyinReady && zhuyinEnabled;

  useEffect(() => {
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch((err) => console.error('Failed to load zhuyin data:', err));
  }, []);

  const processZhuyin = useCallback((text: string): string => {
    if (!zhuyinActive) return text;
    try {
      const processed = PolyphonicProcessor.instance.process(text);
      return buildZhuyinString(processed);
    } catch {
      return text;
    }
  }, [zhuyinActive]);

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    try {
      return story.content.map((line) => {
        const processed = PolyphonicProcessor.instance.process(line);
        return buildZhuyinString(processed);
      });
    } catch {
      return null;
    }
  }, [story.content, zhuyinActive]);

  // Scroll to bottom whenever conversation updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isLoading]);

  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Helper to apply server response to local state
  const applyServerState = useCallback((result: ChatResponse) => {
    setUnderstoodCount(result.understood_count);
    setRequiredCount(result.required_count);
    setIsSessionComplete(result.is_complete);

    // Highlight referenced paragraph on wrong answer
    if (result.understood === false && result.referenced_paragraph != null) {
      setHighlightedParagraph(result.referenced_paragraph - 1);
      // On mobile, auto-switch to story tab when highlighting
      if (isMobile) {
        setActiveTab('story');
      }
      // Auto-scroll to highlighted paragraph
      setTimeout(() => {
        paragraphRefs.current[result.referenced_paragraph! - 1]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);
    } else {
      setHighlightedParagraph(null);
    }
  }, [isMobile]);

  // Fetch the first question from the server (no student answer)
  const fetchFirstQuestion = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const storyText = story.content.join('\n');
      const result = await sendComprehensionChat({
        sessionId,
        storyTitle: story.title,
        storyText,
        studentAnswer: null,
        // Pass reading results from LiveTutor (Issue #17)
        // Filter out 0/empty values to avoid backend validation errors (Issue #48)
        mispronouncedWords: attempt.mispronouncedWords?.length ? attempt.mispronouncedWords : undefined,
        accuracy: attempt.accuracy || undefined,
        cpm: attempt.cpm || undefined,
        // Persist dialogue to DB when DB session ID is available (Issue #242)
        dbSessionId: dbSessionId ?? undefined,
        token: token ?? undefined,
      });
      setConversation([{ role: 'ai', text: result.question }]);
      applyServerState(result);
    } catch {
      setError('無法連線到伺服器，請確認後端已啟動。');
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [story.content, story.title, sessionId, attempt, applyServerState]);

  // Resizable right panel (mouse + touch)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || !e.touches.length) return;
      const delta = dragStartXRef.current - e.touches[0].clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onEnd = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [onPanelWidthChange]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const onDividerTouchStart = (e: React.TouchEvent) => {
    if (!e.touches.length) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.touches[0].clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  // Fetch the first question on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    fetchFirstQuestion();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    const text = inputText.trim();
    if (!text || isLoading || isSessionComplete) return;

    const studentTurn: ChatMessage = { role: 'student', text };
    setConversation(prev => [...prev, studentTurn]);
    setInputText('');
    setIsLoading(true);
    setError(null);
    setHighlightedParagraph(null);

    try {
      const storyText = story.content.join('\n');
      const result = await sendComprehensionChat({
        sessionId,
        storyTitle: story.title,
        storyText,
        studentAnswer: text,
        // Persist dialogue to DB when DB session ID is available (Issue #242)
        dbSessionId: dbSessionId ?? undefined,
        token: token ?? undefined,
      });

      applyServerState(result);

      const newMessages: ChatMessage[] = [];

      // Add feedback if present
      if (result.feedback && result.understood !== null) {
        newMessages.push({
          role: 'feedback',
          text: result.feedback,
          understood: result.understood,
          // Pick encouragement phrase at message-creation time so it stays stable on re-renders
          encouragement: result.understood === false ? getEncouragementMessage() : undefined,
        });
      }

      // Add next AI question if session is not complete
      if (!result.is_complete) {
        newMessages.push({ role: 'ai', text: result.question });
      }

      setConversation(prev => [...prev, ...newMessages]);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        // Session expired after backend redeploy — auto-rebuild
        setConversation([]);
        setInputText(text); // Preserve their answer for re-submit
        await fetchFirstQuestion();
        setError('對話已重新開始，請再送出一次你的回答。');
      } else {
        setError('無法連線到伺服器，請確認後端已啟動。');
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleRetry = () => {
    setError(null);
    if (conversation.length === 0) {
      fetchFirstQuestion();
    } else {
      // Find the last student message to re-submit
      const lastStudentTurn = [...conversation].reverse().find(t => t.role === 'student');
      if (lastStudentTurn) {
        // Remove the last student turn and re-submit
        setConversation(prev => prev.slice(0, prev.length - 1));
        setInputText(lastStudentTurn.text);
      } else {
        fetchFirstQuestion();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Prevent submission during IME composition (Chinese/Japanese/Korean input)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Extract chat content to reuse in both mobile and desktop layouts
  const renderChatMessages = () => (
    <>
      {/* Intro message */}
      <div className="flex gap-2.5 pt-1">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent flex items-center justify-center">
          <span className="text-white text-[10px] font-bold">AI</span>
        </div>
        <div className="flex-1">
          <div className="bg-accent-bg border border-accent-bg-subtle rounded-2xl rounded-tl-sm px-4 py-3">
            <p className={`text-lg text-accent-hover leading-[1.8] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
              {processZhuyin(`你剛才讀完了《${story.title}》，做得很棒！讓我們來聊聊課文的內容吧。`)}
            </p>
          </div>
        </div>
      </div>

      {/* Conversation turns */}
      {conversation.map((turn, i) => {
        // Feedback message
        if (turn.role === 'feedback') {
          return (
            <div key={i} className="mx-10 space-y-1.5">
              {/* Encouragement badge shown above hint when student answered incorrectly */}
              {!turn.understood && turn.encouragement && (
                <div className="animate-fade-in flex items-center gap-1.5 text-amber-700 text-xs font-semibold">
                  <span>✨</span>
                  <span>{processZhuyin(turn.encouragement)}</span>
                </div>
              )}
              <div className={`rounded-xl px-3.5 py-2 text-sm border ${
                turn.understood
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-amber-50 border-amber-300 text-amber-800'
              }`}>
                <span className="mr-1.5">{turn.understood ? '✓' : '💡'}</span>
                {processZhuyin(turn.text)}
              </div>
            </div>
          );
        }

        // AI or student message
        return (
          <div key={i} className={`flex gap-2.5 ${turn.role === 'student' ? 'flex-row-reverse' : ''}`}>
            {turn.role === 'ai' ? (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">AI</span>
              </div>
            ) : (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            )}
            <div className={`max-w-[85%] flex flex-col ${turn.role === 'student' ? 'items-end' : ''}`}>
              <div className={[
                'rounded-2xl px-4 py-3',
                turn.role === 'ai'
                  ? 'bg-accent-bg border border-accent-bg-subtle rounded-tl-sm text-accent-hover'
                  : 'bg-accent rounded-tr-sm text-white',
              ].join(' ')}>
                <p className={`text-lg leading-[1.8] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>{processZhuyin(turn.text)}</p>
              </div>
            </div>
          </div>
        );
      })}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex gap-2.5">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">AI</span>
          </div>
          <div className="bg-accent-bg border border-accent-bg-subtle rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-accent-light rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-accent-light rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-accent-light rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-3.5 py-2.5 text-sm text-red-600">
          {error}
          <button
            onClick={handleRetry}
            className="ml-2 underline hover:no-underline"
          >
            重試
          </button>
        </div>
      )}

      {/* Completion message */}
      {isSessionComplete && !isLoading && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
          <p className="text-emerald-800 font-bold text-sm">太棒了！你展現了很好的理解力！</p>
          <p className="text-emerald-700 text-xs mt-1">你對課文的理解很好，繼續下一步吧！</p>
        </div>
      )}

      <div ref={chatEndRef} />
    </>
  );

  const renderInputArea = () => (
    <div className="shrink-0 bg-white border-t border-gray-200 p-3">
      {isSessionComplete ? (
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="px-3 py-3 rounded-xl text-base text-gray-500 hover:text-gray-900 transition-colors"
          >
            ← 回到朗讀
          </button>
          <button
            onClick={() => onFinish({ understoodCount, requiredCount, isComplete: isSessionComplete, conversationLength: conversation.length })}
            className="flex-1 py-3 rounded-xl font-bold text-base bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            繼續，生字練習
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入你的回答……（Enter 送出）"
            rows={2}
            disabled={isLoading || isSessionComplete}
            className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!inputText.trim() || isLoading || isSessionComplete}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-accent hover:bg-accent-hover disabled:bg-gray-300 disabled:text-gray-400 text-white flex items-center justify-center transition-all active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex ${isMobile ? 'flex-col' : 'flex-row'} flex-1 h-full bg-amber-50 overflow-hidden`}
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {isMobile ? (
        /* MOBILE: Tab-based layout */
        <>
          {/* Tab bar */}
          <div className="flex bg-white border-b border-gray-200 shrink-0">
            <button
              onClick={() => setActiveTab('story')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                activeTab === 'story'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              課文
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                activeTab === 'chat'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              AI 對話
            </button>
            <div className="flex items-center px-2">
              <ZhuyinToggle enabled={zhuyinEnabled} ready={zhuyinReady} onToggle={() => setZhuyinEnabled(!zhuyinEnabled)} />
            </div>
          </div>

          {activeTab === 'story' ? (
            /* Story panel - full height */
            <div className="flex-1 flex flex-col bg-amber-50 min-h-0">
              <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-12">
                  {story.content.map((line, idx) => (
                    <div
                      key={idx}
                      ref={el => { paragraphRefs.current[idx] = el; }}
                      className={`rounded-2xl px-4 py-8 border transition-all ${
                        highlightedParagraph === idx
                          ? 'border-amber-500/60 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                          : 'border-transparent hover:border-gray-200 hover:bg-white/40'
                      }`}
                    >
                      <p className={`text-xl text-gray-900 leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                        {zhuyinLines ? zhuyinLines[idx] : line}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Chat panel - full height with input */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Panel header with progress */}
              <div className="h-9 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
                <span className="text-[10px] font-black text-accent-light uppercase tracking-widest">
                  AI Tutor
                </span>
                <div className="flex-1" />
                <span className="text-[10px] text-gray-600">
                  {understoodCount} / {requiredCount} 理解
                </span>
                <button onClick={() => onFinish({ understoodCount, requiredCount, isComplete: isSessionComplete, conversationLength: conversation.length })} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">
                  跳過
                </button>
              </div>

              {/* Chat messages */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-gray-50">
                {renderChatMessages()}
              </div>

              {/* Input area */}
              {renderInputArea()}
            </div>
          )}
        </>
      ) : (
        /* DESKTOP: Current dual-panel layout */
        <>
          {/* LEFT: Story text panel */}
          <div className="flex-1 flex flex-col bg-amber-50 min-w-0">
            {/* Tab bar */}
            <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
              <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800 gap-2">
                {story.filename}
              </div>
              <div className="flex-1" />
              <ZhuyinToggle enabled={zhuyinEnabled} ready={zhuyinReady} onToggle={() => setZhuyinEnabled(!zhuyinEnabled)} />
            </div>

            {/* Story content — all paragraphs visible for reference */}
            <div className="flex-1 p-8 lg:p-16 overflow-y-auto custom-scrollbar">
              <div className="max-w-3xl mx-auto space-y-20">
                {story.content.map((line, idx) => (
                  <div
                    key={idx}
                    ref={el => { paragraphRefs.current[idx] = el; }}
                    className={`rounded-2xl px-6 py-12 border transition-all ${
                      highlightedParagraph === idx
                        ? 'border-amber-500/60 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                        : 'border-transparent hover:border-gray-200 hover:bg-white/40'
                    }`}
                  >
                    <p className={`text-2xl lg:text-3xl text-gray-900 leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                      {zhuyinLines ? zhuyinLines[idx] : line}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Status bar */}
            <div className="h-7 bg-white border-t border-gray-200 flex items-center px-4 text-[10px] text-gray-500 uppercase shrink-0">
              <span>共 {story.content.length} 段 · {story.title}</span>
            </div>
          </div>

          {/* Resizable divider */}
          <div
            onMouseDown={onDividerMouseDown}
            onTouchStart={onDividerTouchStart}
            className="w-1 flex-shrink-0 bg-gray-200 hover:bg-accent cursor-col-resize transition-colors"
          />

          {/* RIGHT: AI Tutor chat panel */}
          <div className="flex-shrink-0 bg-white flex flex-col h-full min-h-0" style={{ width: rightPanelWidth }}>
            {/* Panel header */}
            <div className="h-9 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
              <span className="text-[10px] font-black text-accent-light uppercase tracking-widest">
                AI Tutor
              </span>
              <div className="flex-1" />
              <span className="text-[10px] text-gray-600">
                {understoodCount} / {requiredCount} 理解
              </span>
              <button
                onClick={() => onFinish({ understoodCount, requiredCount, isComplete: isSessionComplete, conversationLength: conversation.length })}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                跳過
              </button>
            </div>

            {/* Chat messages */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-gray-50">
              {renderChatMessages()}
            </div>

            {/* Input area */}
            {renderInputArea()}
          </div>
        </>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default ComprehensionChat;
