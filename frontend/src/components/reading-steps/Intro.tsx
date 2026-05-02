
import React, { useState, useCallback } from 'react';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';

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
  const { zhuyinActive, processZhuyin } = useZhuyin();

  const speakIntro = useCallback(() => {
    if (!window.speechSynthesis || !story.intro) return;
    window.speechSynthesis.cancel();

    const text = `${story.title}。作者：${story.intro.author}。${story.intro.background}`;
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
        fontFamily: zhuyinActive
          ? "'BpmfZihiSans', 'Noto Sans TC', sans-serif"
          : undefined,
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
              <h1 className={`text-2xl font-bold text-on-surface ${zhuyinActive ? 'leading-[3rem] tracking-[0.4em]' : 'leading-[1.5]'}`}>
                {processZhuyin(story.title)}
              </h1>
              {story.intro && (
                <p
                  className={`text-base ${zhuyinActive ? 'leading-[2.6] tracking-[0.3em]' : 'leading-[1.5]'} text-gray-600`}
                  aria-label={`作者：${story.intro.author}`}
                >
                  {processZhuyin(story.intro.author)}
                </p>
              )}
            </div>
          </div>

          {/* ⑨ 知識補給站 — YouTube embed */}
          {story.knowledgeVideoUrl && (() => {
            const url = story.knowledgeVideoUrl!;
            const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
            const videoId = match?.[1];
            if (!videoId) return null;
            return (
              <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">⑨ 知識補給站</span>
                </div>
                <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                  <iframe
                    className="absolute inset-0 w-full h-full rounded-xl"
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title="知識補給站影片"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            );
          })()}

          {/* 學習目標 banner — worksheet_intro.target_strategy (#1434) */}
          {story.worksheetIntro?.target_strategy && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
                <span className="text-xs font-bold text-blue-600 uppercase tracking-widest">學習目標</span>
              </div>
              <p className={`text-blue-800 text-xl font-semibold ${zhuyinActive ? 'leading-[3rem] tracking-[0.3em]' : 'leading-[1.5]'}`}>
                {processZhuyin(story.worksheetIntro.target_strategy)}
              </p>

              {/* 學習提示 checklist */}
              {story.worksheetIntro.instructions && story.worksheetIntro.instructions.length > 0 && (
                <ul className="space-y-1.5 pt-1" aria-label="學習提示">
                  {story.worksheetIntro.instructions.map((item, idx) => (
                    <li key={idx} className={`flex items-start gap-2 text-blue-700 ${zhuyinActive ? 'text-lg leading-[2.8rem] tracking-[0.2em]' : 'text-base leading-[1.6]'}`}>
                      <span className="mt-1 flex-shrink-0 text-blue-400" aria-hidden="true">&#9655;</span>
                      <span>{processZhuyin(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Background section — story.intro.background (Layer-1 backward compat) */}
          {story.intro ? (
            <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-bold text-accent-light uppercase tracking-widest">課文簡介</span>
              </div>
              <p className={`text-on-surface text-2xl ${zhuyinActive ? 'leading-[3.5rem] tracking-[0.4em]' : 'leading-[1.6]'}`}>
                {processZhuyin(story.intro.background)}
              </p>

              {/* TTS button */}
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
          ) : (
            !story.worksheetIntro && (
              <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 text-gray-500 text-sm">
                這篇課文目前沒有簡介資料。
              </div>
            )
          )}

          {/* 學習單流程 — worksheet_section_order (#1434) */}
          {story.worksheetSectionOrder && story.worksheetSectionOrder.length > 0 && (
            <div className="bg-surface-container-low border border-gray-200 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span className="text-xs font-bold text-accent-light uppercase tracking-widest">
                  本課 {story.worksheetSectionOrder.length} 個學習步驟
                </span>
              </div>
              <ol className="space-y-2" aria-label="學習單流程">
                {story.worksheetSectionOrder.map((section, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-bg-subtle text-accent-hover text-sm font-bold flex items-center justify-center">
                      {section.number}
                    </span>
                    <span className={`text-on-surface ${zhuyinActive ? 'text-lg leading-[2.8rem] tracking-[0.2em]' : 'text-base'}`}>
                      {processZhuyin(section.name)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

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
    </div>
  );
};

export default Intro;
