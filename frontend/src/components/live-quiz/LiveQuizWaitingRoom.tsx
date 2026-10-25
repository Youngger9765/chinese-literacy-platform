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
 * `players_count` as a grid of ANONYMOUS placeholder avatars — numbered
 * ("同學1", "同學2"...) with a cycling color (round 4: Young reviewed
 * round 3's single-gray-silhouette version — "人數多時要是頭像網格，匿名
 * 就用編號＋隨機色") — it visualizes "there are N distinguishable people
 * here" without inventing or leaking any classmate's real identity. If
 * this product decision changes later (e.g. the backend starts exposing
 * an anonymized "學生N" list to players, the same pattern
 * `anonymous_display_name` already uses elsewhere in this engine), swap
 * `AnonymousPeer` for real entries — the layout already reserves one slot
 * per `players_count`.
 *
 * round 4 (Young reviewed round-3 screenshots again): "版面下方仍空一大塊、
 * 卡片只佔畫面上半；桌機請讓大廳卡片填滿可視高度（或把同學牆區放大成多列
 * 格狀），加上「老師開始後自動進入第一題」的倒數感提示". Three changes:
 * (1) the gradient card itself now carries `flex-1` so it stretches to
 * fill whatever height its parent page gives it, instead of sizing to its
 * own content and leaving a bare strip of page background below — the
 * page's own outer wrapper was already `flex-1`, this component's root
 * just never passed that down to the visible card.
 * (2) the peer wall switched from a `flex flex-wrap` row to a `grid` —
 * reads as "多列格狀" even at low counts instead of one shy centered row.
 * (3) a small pulsing pill near the bottom states the auto-advance
 * behavior explicitly, so "等待" doesn't read as "nothing is about to
 * happen" — there's no literal countdown number available from the
 * polled state, so the "倒數感" here is the same reduced-motion-safe
 * pulse used elsewhere, not a ticking clock.
 */
import React from 'react';

/** Cycling palette for anonymous peer avatars — "隨機色" in the sense of
 * "visibly different colors so a grid of many peers isn't a wall of
 * identical gray circles", not re-randomized on every render (that would
 * make each peer's color flicker/reassign on every poll tick, which reads
 * as more broken than helpful). Deterministic by index instead. */
const PEER_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#A855F7', '#EC4899', '#14B8A6', '#F97316'];

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

/** A single anonymous "someone is here" placeholder — numbered + colored
 * (not a name — see module docstring on the privacy constraint), with a
 * gentle staggered pulse so the wall reads as "people waiting", not a
 * static grid. `index` both picks the color and the "同學N" label. */
const AnonymousPeer: React.FC<{ index: number }> = ({ index }) => (
  <div className="flex flex-col items-center gap-1" title={`同學${index + 1}`}>
    <div
      className="flex h-14 w-14 shrink-0 animate-pulse items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: PEER_COLORS[index % PEER_COLORS.length], animationDelay: `${(index % 4) * 200}ms` }}
      aria-hidden="true"
    >
      {index + 1}
    </div>
    <span className="text-[10px] text-white/70">同學{index + 1}</span>
  </div>
);

const LiveQuizWaitingRoom: React.FC<LiveQuizWaitingRoomProps> = ({ myName, playersCount, onLeave }) => {
  const otherCount = Math.max(playersCount - 1, 0);
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="w-full max-w-3xl pt-2 text-left">
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

      {/* round 4: `flex-1` here is the actual fix for "卡片只佔畫面上半" —
          this card now claims all the height its flex-column parent has
          to offer instead of sizing to content. `data-testid` so the
          round-4 regression lock can assert the class directly (jsdom has
          no layout engine, can't assert the visual effect itself). */}
      <div
        data-testid="lobby-card"
        className="mt-4 flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[#F0624D] to-[#D63B2F] shadow-sm"
      >
        <div className="relative flex flex-1 flex-col items-center justify-center gap-5 px-5 pb-6 pt-8 sm:px-8">
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
          <h1 className="text-2xl font-bold text-white sm:text-3xl">等待老師開始搶答</h1>

          {/* 自己的名字與頭像大卡 */}
          <div className="flex items-center gap-3 rounded-2xl bg-white/15 px-5 py-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl font-bold text-[#D63B2F]">
              {myName.charAt(0)}
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-white">{myName}</p>
              <p className="text-xs text-white/80">你</p>
            </div>
          </div>

          {/* 已加入同學的頭像牆（匿名，見檔頭註解）— round 4: `grid` instead
              of `flex flex-wrap`, per Young's "放大成多列格狀" alternative;
              also gives this section somewhere to grow into as the class
              fills up, which is the other half of the "填滿可視高度" fix. */}
          <div className="w-full max-w-sm">
            <p className="mb-2 text-center text-sm font-medium text-white/90">
              {playersCount > 0 ? `目前已有 ${playersCount} 人加入` : '還沒有人加入'}
            </p>
            {otherCount > 0 ? (
              <div data-testid="peer-wall" className="grid grid-cols-4 justify-items-center gap-x-2 gap-y-3 sm:grid-cols-6">
                {Array.from({ length: otherCount }).map((_, i) => (
                  <AnonymousPeer key={i} index={i} />
                ))}
              </div>
            ) : (
              <p data-testid="peer-wall" className="grid text-center text-xs text-white/70">
                你是第一位加入的，等其他同學一起來吧
              </p>
            )}
          </div>

          {/* round 4: "加上「老師開始後自動進入第一題」的倒數感提示" — no
              literal countdown number exists in the polled state, so the
              "倒數感" here is conveyed by the pulsing dot (same idiom as
              the hero's breathing glow), not a ticking clock. */}
          <div className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-medium text-white/90">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            老師開始後，畫面會自動跳到第一題，不用自己按
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
