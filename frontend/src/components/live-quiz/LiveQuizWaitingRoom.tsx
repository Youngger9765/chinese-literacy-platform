/**
 * LiveQuizWaitingRoom — the student lobby screen for 課堂搶答 (`status ===
 * 'lobby'` in `StudentLiveQuizPlay.tsx`).
 *
 * History: #3747 added nothing here. #3756/round-2 added three lines of
 * plain text + a back button — Young rejected that: "只是在空白頁中間加了
 * 三行字和一個小卡，畫面還是 90% 空白，不及格...等待室要像遊戲大廳：大標題
 * 與主視覺、自己的名字與頭像大卡、已加入同學的名字／頭像牆（即時更新，用
 * 既有 API 有的資料）、等待動畫、規則改成三個圖示步驟、返回鍵改成「離開」
 * 並有確認". This component is the full rebuild for #3761.
 *
 * Privacy constraint (documented, not an oversight — see
 * `services/live_quiz/engine.py`'s `build_state()`, PRD §13): the backend
 * ONLY includes the `players` name list `if is_host`. A student-viewer's
 * state only ever carries `players_count` (a number) and `your_player`
 * (their OWN name). The "同學牆" below is therefore built from
 * `players_count` as a row of ANONYMOUS placeholder avatars (a generic
 * person glyph, not a name or photo) — it visualizes "there are N people
 * here" without inventing or leaking any classmate's identity. If this
 * product decision changes later (e.g. the backend starts exposing an
 * anonymized "學生N" list to players, the same pattern `anonymous_display_
 * name` already uses elsewhere in this engine), swap `AnonymousPeer` for
 * real entries — the layout already reserves one slot per `players_count`.
 */
import React from 'react';

interface LiveQuizWaitingRoomProps {
  myName: string;
  playersCount: number;
  onLeave: () => void;
}

const STEPS: { icon: React.ReactNode; text: string }[] = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" fill="currentColor" />
      </svg>
    ),
    text: '老師開始後，螢幕上會出現題目',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
        <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    text: '答得又對又快，分數越高',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    text: '答錯或沒答不會倒扣分數',
  },
];

/** A single anonymous "someone is here" placeholder — a generic person
 * glyph, deliberately not a name or initial (see module docstring). */
const AnonymousPeer: React.FC = () => (
  <div
    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white/70"
    aria-hidden="true"
  >
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  </div>
);

const LiveQuizWaitingRoom: React.FC<LiveQuizWaitingRoomProps> = ({ myName, playersCount, onLeave }) => {
  const otherCount = Math.max(playersCount - 1, 0);
  return (
    <div className="flex flex-1 flex-col items-center">
      <div className="w-full max-w-2xl pt-2 text-left">
        {/* #3761: "返回鍵改成「離開」並有確認" — GameBackButton navigates
            straight away; here leaving mid-lobby should confirm first
            (same `window.confirm` pattern TeacherLiveQuizHost.tsx already
            uses for "提前結束這場課堂搶答"). */}
        <button
          type="button"
          onClick={onLeave}
          className="inline-flex items-center gap-1 text-sm font-medium text-on-surface-variant hover:text-on-surface"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          離開
        </button>
      </div>

      <div className="mt-4 w-full max-w-2xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#F0624D] to-[#D63B2F] shadow-sm">
        <div className="relative flex flex-col items-center px-5 pb-6 pt-8 sm:px-8">
          {/* #3761: "等待動畫（例如呼吸光暈或倒數感的動效，尊重 reduced-
              motion）" — `animate-pulse` is a plain CSS animation, already
              neutralized site-wide under `prefers-reduced-motion: reduce`
              (frontend/src/index.css — animation-duration collapses to
              0.01ms there), so no extra JS/hook is needed here (unlike
              PkFigureIntro's STRUCTURAL swap, which does need one). */}
          <div className="relative flex h-24 w-24 items-center justify-center">
            <span className="absolute inset-0 animate-pulse rounded-full bg-white/20" aria-hidden="true" />
            <span className="absolute inset-2 animate-pulse rounded-full bg-white/20 [animation-delay:150ms]" aria-hidden="true" />
            <img src="/story-assets/live-quiz-hub/icon.png" alt="" aria-hidden="true" className="relative h-20 w-20 object-contain" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white sm:text-3xl">等待老師開始搶答</h1>

          {/* 自己的名字與頭像大卡 */}
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/15 px-5 py-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl font-bold text-[#D63B2F]">
              {myName.charAt(0)}
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-white">{myName}</p>
              <p className="text-xs text-white/80">你</p>
            </div>
          </div>

          {/* 已加入同學的頭像牆（匿名，見檔頭註解） */}
          <div className="mt-5 w-full">
            <p className="mb-2 text-center text-sm font-medium text-white/90">
              {playersCount > 0 ? `目前已有 ${playersCount} 人加入` : '還沒有人加入'}
            </p>
            {otherCount > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {Array.from({ length: otherCount }).map((_, i) => (
                  <AnonymousPeer key={i} />
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-white/70">你是第一位加入的，等其他同學一起來吧</p>
            )}
          </div>
        </div>

        <div className="bg-white/10 px-5 py-4 sm:px-8">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-white/80">怎麼玩？</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-white sm:flex-col sm:text-center">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
                  {step.icon}
                </span>
                <span className="text-xs text-white/90 sm:mt-1">{step.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveQuizWaitingRoom;
