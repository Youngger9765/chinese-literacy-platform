
import React, { useState, useCallback, useEffect } from 'react';
import { Story } from '../../types';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';

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
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);

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
      className="flex-1 flex flex-col bg-[#0d1117] overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* Top bar */}
      <div className="h-9 bg-[#161b22] border-b border-[#30363d] flex items-center px-4 gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          圖書館
        </button>
        <span className="text-slate-700 text-xs">›</span>
        <span className="text-xs text-slate-400">{story.title}</span>
        <span className="text-slate-700 text-xs">›</span>
        <span className="text-xs text-indigo-400 font-bold">簡介</span>
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

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

          {/* Hero: thumbnail + title */}
          <div className="flex gap-6 items-start">
            <img
              src={story.thumbnail}
              alt={story.title}
              className="w-32 h-24 object-cover rounded-xl border border-[#30363d] flex-shrink-0"
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/40 uppercase tracking-widest">
                  {CATEGORY_LABEL[story.category] ?? story.category}
                </span>
                <span className="text-[10px] text-slate-600">Lv.{story.level}</span>
              </div>
              <h1 className="text-2xl font-black text-white leading-[2.4]">
                {processZhuyin(story.title)}
              </h1>
              {story.intro && (
                <p className="text-xs text-slate-400 leading-[2.4]">
                  {processZhuyin(story.intro.author)}
                </p>
              )}
            </div>
          </div>

          {/* Background section */}
          {story.intro ? (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">課文簡介</span>
              </div>
              <p className="text-slate-300 text-base leading-[2.4]">
                {processZhuyin(story.intro.background)}
              </p>

              {/* TTS button */}
              <div className="pt-2">
                {isSpeaking ? (
                  <button
                    onClick={stopSpeaking}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-amber-800/50 text-amber-300 border border-amber-700/40 transition-all"
                  >
                    <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10h6v4H9z" />
                    </svg>
                    停止朗讀
                  </button>
                ) : (
                  <button
                    onClick={speakIntro}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-[#30363d] transition-all active:scale-95"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                    </svg>
                    朗讀簡介
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6 text-slate-500 text-sm">
              這篇課文目前沒有簡介資料。
            </div>
          )}

        </div>
      </div>

      {/* Bottom action */}
      <div className="flex-shrink-0 bg-[#161b22] border-t border-[#30363d] px-6 py-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          返回圖書館
        </button>
        <button
          onClick={() => {
            stopSpeaking();
            onStartReading();
          }}
          className="px-8 py-3 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all active:scale-95 flex items-center gap-2"
        >
          開始逐段朗讀
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Intro;
