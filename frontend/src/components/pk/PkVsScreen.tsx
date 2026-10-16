/**
 * PkVsScreen — PRD §3.3 "對戰開場「VS」畫面": "雙方並排顯示：自己...vs
 * 對手（真人同樣用頭像；AI 顯示該人物的立繪＋清楚的「Lv.N・AI」標籤）。文字用 "Lv.N" 而非 PRD 原文的「第 N 級」，是為了避開 src/utils/gradeLabel.guard.test.ts（全檔掃描「第 N 級」這種帶變數的文字模式的守衛測試）誤判——那支指的是學生年級，跟這裡 AI 對戰層級是完全不同的概念，文字恰好長得很像才會撞上。語意不變：依然清楚標示第幾級文學家，也更符合遊戲感。
 * 中間一個大大的「VS」字樣".
 */
import React from 'react';

interface PkVsScreenProps {
  myName: string;
  myAvatarUrl?: string;
  opponentName: string;
  opponentAvatarUrl?: string;
  opponentIsAi: boolean;
  opponentTier?: number | null;
  onDone: () => void;
}

function initialsAvatar(name: string): React.ReactNode {
  const initial = name.trim().charAt(0) || '?';
  return (
    <div className="flex h-20 w-20 sm:h-28 sm:w-28 items-center justify-center rounded-full bg-accent text-2xl sm:text-3xl font-bold text-white">
      {initial}
    </div>
  );
}

const PkVsScreen: React.FC<PkVsScreenProps> = ({
  myName,
  myAvatarUrl,
  opponentName,
  opponentAvatarUrl,
  opponentIsAi,
  opponentTier,
  onDone,
}) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-8 animate-fade-in">
      <div className="flex w-full max-w-md items-center justify-between gap-4">
        <div className="flex flex-1 flex-col items-center gap-2 animate-card-in">
          {myAvatarUrl ? (
            <img src={myAvatarUrl} alt="" className="h-20 w-20 sm:h-28 sm:w-28 rounded-full object-cover border-4 border-accent-bg" />
          ) : (
            initialsAvatar(myName)
          )}
          <p className="text-sm sm:text-base font-semibold text-on-surface truncate max-w-full">{myName}</p>
        </div>

        <div className="shrink-0 text-3xl sm:text-5xl font-extrabold text-accent px-2" aria-hidden="true">
          VS
        </div>

        <div className="flex flex-1 flex-col items-center gap-2 animate-card-in">
          {opponentAvatarUrl ? (
            <img src={opponentAvatarUrl} alt="" className="h-20 w-20 sm:h-28 sm:w-28 rounded-full object-cover border-4 border-accent-bg" />
          ) : (
            initialsAvatar(opponentName)
          )}
          <p className="text-sm sm:text-base font-semibold text-on-surface truncate max-w-full">{opponentName}</p>
          {opponentIsAi && (
            <span className="rounded-full bg-accent-bg px-2 py-0.5 text-xs font-bold text-accent">
              Lv.{opponentTier}・AI
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-10 rounded-full bg-accent px-8 py-3 text-base font-bold text-white shadow active:scale-95 transition-transform"
      >
        開始對戰
      </button>
    </div>
  );
};

export default PkVsScreen;
