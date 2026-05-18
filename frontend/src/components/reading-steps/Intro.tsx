
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { fontForZhuyin } from '../../constants/fonts';
import { resolveActiveSteps } from '../../config/stepConfig';

const CATEGORY_LABEL: Record<string, string> = {
  Fable: '寓言故事',
  Science: '自然科學',
  History: '歷史故事',
  Daily: '生活文化',
};

interface IntroProps {
  story: Story;
  onStartReading: () => void;
  onBack: () => void;
}

const Intro: React.FC<IntroProps> = ({ story, onStartReading, onBack }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showWorksheetModal, setShowWorksheetModal] = useState(false);
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const worksheetModalRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useFocusTrap(worksheetModalRef, showWorksheetModal);

  /**
   * Issue #1637: navigate to /omo with lesson_code query param so OmoPage
   * can pass it as a hint to the backend (skip Gemini fuzzy-match).
   */
  const handleUploadWorksheet = useCallback(() => {
    const lessonCode = story.lesson_code ?? '';
    const params = lessonCode ? `?lesson_code=${encodeURIComponent(lessonCode)}` : '';
    navigate(`/omo${params}`);
  }, [navigate, story.lesson_code]);

  useEffect(() => {
    if (!showWorksheetModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowWorksheetModal(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showWorksheetModal]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === worksheetModalRef.current) {
      setShowWorksheetModal(false);
    }
  }, []);

  const speakIntro = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    // #1598: 課文簡介 only — never fall back to strategy/target text (which would
    // read aloud "圖文題就是..." instead of the actual lesson topic).
    const introText = story.lessonIntro?.course_intro || story.intro?.background || '';
    if (!introText) return;

    const authorPart = story.intro ? `作者：${story.intro.author}。` : '';
    const text = `${story.title}。${authorPart}${introText}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 0.95;

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => v.name.includes('Google') && v.name.includes('Taiwan')) ||
        voices.find(v => v.name.includes('Google') && v.lang === 'zh-TW') ||
        voices.find(v => v.lang === 'zh-TW') ||
        voices.find(v => v.lang.startsWith('zh'));
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
    } else {
      doSpeak();
    }
  }, [story]);

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  };

  return (
    <div
      className="flex-1 flex flex-col bg-amber-50 overflow-hidden"
      style={{
        fontFamily: fontForZhuyin(zhuyinActive),
      }}
    >
      {/* Top bar */}
      <nav aria-label="麵包屑導覽" className="h-9 bg-surface-container-lowest border-b border-gray-200 flex items-center px-4 gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回圖書館"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          圖書館
        </button>
        <span className="text-gray-300 text-xs" aria-hidden="true">›</span>
        <span className="text-xs text-gray-600">{story.title}</span>
        <span className="text-gray-300 text-xs" aria-hidden="true">›</span>
        <span className="text-xs text-accent-light font-bold" aria-current="page">簡介</span>
        <div className="flex-1" />
      </nav>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

          {/* Hero: thumbnail + title */}
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
            <img
              src={story.thumbnail}
              alt={`《${story.title}》課文封面圖`}
              className="w-32 h-24 object-cover rounded-xl border border-gray-200 flex-shrink-0"
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent-bg-subtle text-accent-hover border border-accent-bg-subtle uppercase tracking-widest">
                  {CATEGORY_LABEL[story.category] ?? story.category}
                </span>
                <span className="text-[10px] text-gray-400">難度 {story.level}</span>
              </div>
              <h1 className={`text-2xl font-normal text-on-surface ${zhuyinActive ? 'leading-[2.4rem] tracking-[0.15em]' : 'leading-[1.5]'}`}>
                {processZhuyin(story.title)}
              </h1>
              {story.intro && (
                <p
                  className={`text-base ${zhuyinActive ? 'leading-[2] tracking-[0.15em]' : 'leading-[1.5]'} text-gray-600`}
                  aria-label={`作者：${story.intro.author}`}
                >
                  {processZhuyin(story.intro.author)}
                </p>
              )}
            </div>
          </div>

          {/* 知識補給站 YouTube embed was removed — intro page shows course intro only */}

          {/* 紙本學習單 PDF button (#1444) + 上傳學習單 button (#1637) */}
          {(story.worksheetPdfUrl || story.lesson_code) && (
            <div className="flex flex-wrap items-center gap-2">
              {/* PDF view button — only when a PDF is available */}
              {story.worksheetPdfUrl && (
                <button
                  type="button"
                  onClick={() => setShowWorksheetModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                  aria-label="查看紙本學習單 PDF"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  查看紙本學習單
                </button>
              )}

              {/* Upload button — #1637: available for any lesson with a lesson_code */}
              {story.lesson_code && (
                <button
                  type="button"
                  onClick={handleUploadWorksheet}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-green-300 bg-green-50 hover:bg-green-100 text-green-700 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-1"
                  aria-label="上傳學習單"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  上傳學習單
                </button>
              )}
            </div>
          )}

          {/* 課文簡介 — #1598: only uses lessonIntro.course_intro (AI/PDF generated)
              or intro.background fallback. No longer falls back to strategy
              content (which used to leak into 課文簡介 and confuse students). */}
          {(() => {
            const introText = story.lessonIntro?.course_intro || story.intro?.background;
            if (!introText) {
              return (
                <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 text-gray-500 text-sm">
                  這篇課文目前沒有簡介資料。
                </div>
              );
            }

            const sourceLabel = story.lessonIntro?.course_intro_source?.startsWith('ai-generated')
              ? `資料來源：AI 生成（${story.lessonIntro.course_intro_source.replace('ai-generated-', '')}）`
              : null;

            return (
              <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-bold text-accent-light uppercase tracking-widest">課文簡介</span>
                </div>
                <p className={`text-on-surface text-2xl ${zhuyinActive ? 'leading-[2.4rem] tracking-[0.15em]' : 'leading-[1.6]'}`}>
                  {processZhuyin(introText)}
                </p>

                {sourceLabel && (
                  <p className="text-xs text-on-surface-variant">{sourceLabel}</p>
                )}

                <div className="pt-2">
                  {isSpeaking ? (
                    <button
                      type="button"
                      onClick={stopSpeaking}
                      aria-label="停止朗讀課文簡介"
                      aria-pressed={true}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold bg-amber-800/50 text-amber-800 border border-amber-300 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
                    >
                      <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10h6v4H9z" />
                      </svg>
                      停止朗讀
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={speakIntro}
                      aria-label="朗讀課文簡介"
                      aria-pressed={false}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold border border-gray-300 bg-transparent hover:bg-gray-50 text-gray-800 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                      </svg>
                      朗讀簡介
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 💡 本課學習策略 — #1598: hint-style banner combining the strategy
              name (worksheetIntro.target_strategy), instructions checklist,
              and the longer strategy explanation (lessonIntro.text, which
              used to leak into 課文簡介). */}
          {(story.worksheetIntro?.target_strategy ||
            (story.lessonIntro?.text && story.lessonIntro.source !== 'excel')) && (
            <div className="bg-amber-100/60 border-2 border-amber-300 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">💡</span>
                <span className="text-xs font-bold text-amber-800 uppercase tracking-widest">本課學習策略</span>
              </div>

              {story.worksheetIntro?.target_strategy && (
                <p className={`text-amber-900 text-lg font-semibold ${zhuyinActive ? 'leading-[2.8rem] tracking-[0.25em]' : 'leading-[1.5]'}`}>
                  {processZhuyin(story.worksheetIntro.target_strategy)}
                </p>
              )}

              {story.lessonIntro?.text && story.lessonIntro.source !== 'excel' && (
                <p className={`text-amber-800 ${zhuyinActive ? 'text-base leading-[2.4rem] tracking-[0.2em]' : 'text-sm leading-[1.7]'}`}>
                  {processZhuyin(story.lessonIntro.text)}
                </p>
              )}

              {story.worksheetIntro?.instructions && story.worksheetIntro.instructions.length > 0 && (
                <ul className="space-y-1.5 pt-1" aria-label="學習提示">
                  {story.worksheetIntro.instructions.map((item, idx) => (
                    <li key={idx} className={`flex items-start gap-2 text-amber-800 ${zhuyinActive ? 'text-base leading-[2.8rem] tracking-[0.2em]' : 'text-sm leading-[1.6]'}`}>
                      <span className="mt-1 flex-shrink-0 text-amber-500" aria-hidden="true">&#9655;</span>
                      <span>{processZhuyin(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 數位學習步驟 — derived from step_sequence (same source as StepperNav dots, #1508) */}
          {(() => {
            // Resolve from lesson's step_sequence (or DEFAULT_STEP_SEQUENCE),
            // then exclude the 'intro' step itself (this page IS the intro).
            const digitalSteps = resolveActiveSteps(story.stepSequence).filter(s => s.id !== 'intro');
            if (digitalSteps.length === 0) return null;
            return (
              <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="text-xs font-bold text-accent-light uppercase tracking-widest">
                    本課 {digitalSteps.length} 個學習步驟
                  </span>
                </div>
                <ol className="space-y-2" aria-label="數位學習步驟">
                  {digitalSteps.map((step, idx) => (
                    <li key={step.id} className="flex items-center gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-bg-subtle text-accent-hover text-sm font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className={`text-on-surface ${zhuyinActive ? 'text-lg leading-[2.8rem] tracking-[0.2em]' : 'text-base'}`}>
                        {processZhuyin(step.label)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}

        </div>
      </div>

      {/* Bottom action */}
      <div className="flex-shrink-0 bg-surface-container-lowest border-t border-gray-200 px-6 py-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 rounded-full text-sm text-gray-500 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          返回圖書館
        </button>
        <button
          type="button"
          onClick={() => {
            stopSpeaking();
            onStartReading();
          }}
          className="px-6 py-2.5 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          開始逐段朗讀
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 紙本學習單 PDF Modal (#1444) */}
      {showWorksheetModal && story.worksheetPdfUrl && (
        <div
          ref={worksheetModalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="紙本學習單"
          onClick={handleBackdropClick}
        >
          <div className="relative flex flex-col bg-white w-full h-full sm:rounded-2xl sm:max-w-4xl sm:h-[90vh] shadow-2xl overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 sm:rounded-t-2xl">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-bold text-gray-700 flex-shrink-0">紙本學習單</span>
                <span className="text-xs text-gray-400 hidden sm:inline truncate">— {story.title}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowWorksheetModal(false)}
                className="p-1.5 rounded-full hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 flex-shrink-0"
                aria-label="關閉學習單"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <iframe
              src={story.worksheetPdfUrl}
              title="紙本學習單"
              className="flex-1 w-full bg-gray-100"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Intro;
