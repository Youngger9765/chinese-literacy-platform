import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story, ReadingAttempt } from '../../types';
import { sendComprehensionChat, ChatResponse, SessionExpiredError } from '../../services/api';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';

interface ComprehensionChatProps {
  story: Story;
  attempt: ReadingAttempt;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: () => void;
  onBack: () => void;
}

type ChatMessage =
  | { role: 'ai'; text: string }
  | { role: 'student'; text: string }
  | { role: 'feedback'; text: string; understood: boolean };

const ComprehensionChat: React.FC<ComprehensionChatProps> = ({
  story,
  attempt,
  rightPanelWidth,
  onPanelWidthChange,
  onFinish,
  onBack,
}) => {
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);

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
      setHighlightedParagraph(result.referenced_paragraph);
      // Auto-scroll to highlighted paragraph
      setTimeout(() => {
        paragraphRefs.current[result.referenced_paragraph!]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);
    } else {
      setHighlightedParagraph(null);
    }
  }, []);

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

  // Resizable right panel
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'col-resize';
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
      });

      applyServerState(result);

      const newMessages: ChatMessage[] = [];

      // Add feedback if present
      if (result.feedback && result.understood !== null) {
        newMessages.push({
          role: 'feedback',
          text: result.feedback,
          understood: result.understood,
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="flex flex-1 h-full bg-[#0d1117] overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >

      {/* LEFT: Story text panel */}
      <div className="flex-1 flex flex-col bg-[#0d1117] min-w-0">
        {/* Tab bar */}
        <div className="h-9 bg-[#161b22] border-b border-[#30363d] flex items-center px-2 gap-2 shrink-0">
          <div className="h-full px-4 flex items-center bg-[#0d1117] border-t-2 border-indigo-500 border-x border-[#30363d] text-xs text-slate-200 gap-2">
            {story.filename}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setZhuyinEnabled(!zhuyinEnabled)}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              zhuyinEnabled && zhuyinReady
                ? 'bg-indigo-600/80 text-white hover:bg-indigo-500'
                : 'bg-[#30363d] text-slate-400 hover:bg-[#3d444d]'
            }`}
          >
            注音 {zhuyinEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Story content — all paragraphs visible for reference */}
        <div className="flex-1 p-8 lg:p-16 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-10">
            {story.content.map((line, idx) => (
              <div
                key={idx}
                ref={el => { paragraphRefs.current[idx] = el; }}
                className={`rounded-2xl p-6 border transition-all ${
                  highlightedParagraph === idx
                    ? 'border-amber-500/60 bg-amber-900/10 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                    : 'border-transparent hover:border-[#30363d] hover:bg-[#161b22]/40'
                }`}
              >
                <p className={`text-2xl lg:text-3xl text-slate-300 leading-[2.8] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                  {zhuyinLines ? zhuyinLines[idx] : line}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Status bar */}
        <div className="h-7 bg-[#161b22] border-t border-[#30363d] flex items-center px-4 text-[10px] text-slate-500 uppercase shrink-0">
          <span>共 {story.content.length} 段 · {story.title}</span>
        </div>
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={onDividerMouseDown}
        className="w-1 flex-shrink-0 bg-[#30363d] hover:bg-indigo-500 cursor-col-resize transition-colors"
      />

      {/* RIGHT: AI Tutor chat panel */}
      <div className="flex-shrink-0 bg-[#0d1117] flex flex-col h-full min-h-0" style={{ width: rightPanelWidth }}>
        {/* Panel header */}
        <div className="h-9 shrink-0 bg-[#161b22] border-b border-[#30363d] flex items-center px-4 gap-3">
          <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
            AI Tutor
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-slate-600">
            {understoodCount} / {requiredCount} 理解
          </span>
          <button
            onClick={onFinish}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            跳過
          </button>
        </div>

        {/* Chat messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-black/10">

          {/* Intro message */}
          <div className="flex gap-2.5 pt-1">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">AI</span>
            </div>
            <div className="flex-1">
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl rounded-tl-sm px-4 py-3">
                <p className={`text-lg text-slate-300 leading-[1.8] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
                  {processZhuyin(`你剛才讀完了《${story.title}》，做得很棒！我想問你幾個關於課文的問題，幫助你更深入理解。準備好了嗎？`)}
                </p>
              </div>
            </div>
          </div>

          {/* Conversation turns */}
          {conversation.map((turn, i) => {
            // Feedback message
            if (turn.role === 'feedback') {
              return (
                <div key={i} className={`mx-10 rounded-xl px-3.5 py-2 text-sm border ${
                  turn.understood
                    ? 'bg-emerald-900/20 border-emerald-700/40 text-emerald-300'
                    : 'bg-amber-900/20 border-amber-700/40 text-amber-300'
                }`}>
                  <span className="mr-1.5">{turn.understood ? '✓' : '💡'}</span>
                  {processZhuyin(turn.text)}
                </div>
              );
            }

            // AI or student message
            return (
              <div key={i} className={`flex gap-2.5 ${turn.role === 'student' ? 'flex-row-reverse' : ''}`}>
                {turn.role === 'ai' ? (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">AI</span>
                  </div>
                ) : (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                )}
                <div className={`max-w-[85%] flex flex-col ${turn.role === 'student' ? 'items-end' : ''}`}>
                  <div className={[
                    'rounded-2xl px-4 py-3',
                    turn.role === 'ai'
                      ? 'bg-[#161b22] border border-[#30363d] rounded-tl-sm text-slate-300'
                      : 'bg-indigo-600 rounded-tr-sm text-white',
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
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">AI</span>
              </div>
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/30 border border-red-700/40 rounded-xl px-3.5 py-2.5 text-sm text-red-300">
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
            <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-2xl p-4 text-center">
              <p className="text-emerald-300 font-bold text-sm">太棒了！你展現了很好的理解力！</p>
              <p className="text-emerald-400/70 text-xs mt-1">你對課文的理解很好，繼續下一步吧！</p>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Bottom: input or proceed button */}
        <div className="shrink-0 bg-[#161b22] border-t border-[#30363d] p-3">
          {isSessionComplete ? (
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={onBack}
                className="px-3 py-3 rounded-xl text-base text-slate-500 hover:text-slate-300 transition-colors"
              >
                ← 回到朗讀
              </button>
              <button
                onClick={onFinish}
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
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-base text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-50"
              />
              <button
                onClick={handleSubmit}
                disabled={!inputText.trim() || isLoading || isSessionComplete}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white flex items-center justify-center transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #30363d; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4b5563; }
      `}</style>
    </div>
  );
};

export default ComprehensionChat;
