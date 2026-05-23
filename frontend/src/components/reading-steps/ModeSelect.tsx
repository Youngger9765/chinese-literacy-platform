/**
 * ModeSelect.tsx
 *
 * Mode intro card for ZhuyinPhoneticGame.
 * Lets the student choose: 選聲母 / 選韻母 / 拼音合成.
 *
 * Extracted from ZhuyinPhoneticGame.tsx as part of refactor/issue-1885.
 */

import React from 'react';
import { GameMode } from './zhuyinGameEngine';

export interface ModeSelectProps {
  charCount: number;
  onSelect: (mode: GameMode) => void;
  onBack: () => void;
}

export function ModeSelect({ charCount, onSelect, onBack }: ModeSelectProps) {
  const modes: { id: GameMode; label: string; desc: string; icon: string }[] = [
    { id: 'initial', label: '選聲母', desc: '看字選出正確的聲母 ㄅㄆㄇ…', icon: '🔤' },
    { id: 'final',   label: '選韻母', desc: '看字選出正確的韻母 ㄚㄛㄜ…', icon: '🎵' },
    { id: 'compose', label: '拼音合成', desc: '把注音符號拼出正確的字音', icon: '🧩' },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-indigo-50 px-6 py-10">
      <div className="max-w-sm w-full bg-white rounded-3xl shadow-lg border border-indigo-100 p-8 flex flex-col items-center gap-6">
        <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-3xl select-none">
          🎮
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-1">注音拼讀練習</h2>
          <p className="text-sm text-gray-500">本課有 {charCount} 個字可以練習，請選擇模式</p>
        </div>
        <div className="w-full flex flex-col gap-3">
          {modes.map(m => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-indigo-100 hover:border-indigo-400 hover:bg-indigo-50 transition-all active:scale-95 text-left"
            >
              <span className="text-2xl select-none">{m.icon}</span>
              <div>
                <div className="font-bold text-gray-900 text-sm">{m.label}</div>
                <div className="text-xs text-gray-500">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          返回生字練習
        </button>
      </div>
    </div>
  );
}
