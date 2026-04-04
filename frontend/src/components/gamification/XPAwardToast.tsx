/**
 * XPAwardToast — animated overlay shown after session completion.
 * Shows XP earned, level up (if any), and new badges.
 * Auto-dismisses after 4 seconds or on button click.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

/** Minimal shape needed for the toast — compatible with both gamificationApi and api.ts results. */
export interface XPAwardResult {
  xp_earned: number;
  xp_breakdown?: { event_type: string; xp: number; note: string }[];
  new_total_xp: number;
  level_info: {
    level: number;
    level_name: string;
    total_xp: number;
    progress_pct: number;
    next_level_xp: number | null;
    xp_to_next: number;
    current_level_xp: number;
  };
  streak: {
    current: number;
    longest: number;
  };
  badges_unlocked: string[];
  notes?: string[];
}

interface XPAwardToastProps {
  result: XPAwardResult;
  onDismiss: () => void;
}

const BADGE_ICONS: Record<string, string> = {
  first_story: '⭐',
  story_5:     '📖',
  story_10:    '📚',
  story_25:    '🏛',
  streak_3:    '🔥',
  streak_7:    '🔥',
  streak_30:   '🏆',
  accuracy_90: '🎤',
  accuracy_100:'🎖',
  level_5:     '🧠',
  level_10:    '👑',
  xp_500:      '⚡',
  xp_1000:     '⚡',
};

const BADGE_NAMES: Record<string, string> = {
  first_story: '第一步',
  story_5:     '勤讀者',
  story_10:    '閱讀達人',
  story_25:    '博覽群書',
  streak_3:    '三日不輟',
  streak_7:    '週週精進',
  streak_30:   '月月堅持',
  accuracy_90: '精準朗讀',
  accuracy_100:'完美表現',
  level_5:     '思考者',
  level_10:    '國文之星',
  xp_500:      '積分達人',
  xp_1000:     '千分英雄',
};

/** XP thresholds for each level. Index = level number (level 0 starts at 0 XP). */
const LEVEL_THRESHOLDS = [0, 100, 250, 500, 800, 1200, 1700, 2300, 3000, 4000] as const;

/** Given a total XP value, return the corresponding level. */
function getLevelForXP(totalXP: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXP >= LEVEL_THRESHOLDS[i]) return i;
  }
  return 0;
}

const AUTO_DISMISS_MS = 4000;

const XPAwardToast: React.FC<XPAwardToastProps> = ({ result, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  // --- Pause-on-hover timer (WCAG 2.2.1) ---
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const startedAtRef = useRef(Date.now());

  const startDismissTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    dismissTimerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, remainingRef.current);
  }, [onDismiss]);

  const pauseDismissTimer = useCallback(() => {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
      const elapsed = Date.now() - startedAtRef.current;
      remainingRef.current = Math.max(remainingRef.current - elapsed, 500);
    }
  }, []);

  useEffect(() => {
    // Trigger animation in
    const showTimer = setTimeout(() => setVisible(true), 50);
    // Start auto-dismiss countdown
    startDismissTimer();
    return () => {
      clearTimeout(showTimer);
      if (dismissTimerRef.current != null) clearTimeout(dismissTimerRef.current);
    };
  }, [startDismissTimer]);

  const handleMouseEnter = () => pauseDismissTimer();
  const handleMouseLeave = () => startDismissTimer();

  const { xp_earned, new_total_xp, level_info, badges_unlocked } = result;

  // Level-up detection: compare level before this XP award vs current level
  const previousTotalXP = level_info.total_xp - xp_earned;
  const previousLevel = getLevelForXP(previousTotalXP);
  const levelUp = previousLevel < level_info.level;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="bg-white rounded-3xl shadow-2xl border-2 border-blue-100 px-6 py-5 min-w-[280px] max-w-sm">
        {/* XP gained */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <div>
              <div className="font-black text-2xl text-blue-600">+{xp_earned} XP</div>
              <div className="text-xs text-gray-400">累計 {new_total_xp} XP</div>
            </div>
          </div>
          {level_info && (
            <div className="text-right">
              <div className="text-xs text-gray-500">現在等級</div>
              <div className="font-black text-lg text-gray-700">Lv.{level_info.level}</div>
            </div>
          )}
        </div>

        {/* Level up banner */}
        {levelUp && (
          <div className="bg-gradient-to-r from-amber-400 to-orange-400 rounded-xl py-2 px-3 mb-3 text-center">
            <span className="text-white font-black text-sm">升級了！{level_info.level_name}</span>
          </div>
        )}

        {/* Streak */}
        {result.streak.current > 1 && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-orange-500">🔥</span>
            <span className="text-sm text-gray-600">
              連續 <strong>{result.streak.current}</strong> 天學習！
            </span>
          </div>
        )}

        {/* New badges */}
        {badges_unlocked.length > 0 && (
          <div className="mb-3">
            <div className="text-xs text-gray-500 font-medium mb-1.5">解鎖新徽章</div>
            <div className="flex flex-wrap gap-2">
              {badges_unlocked.map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-1 bg-yellow-50 border border-yellow-200 rounded-full px-2 py-1"
                >
                  <span className="text-base">{BADGE_ICONS[key] ?? '🏅'}</span>
                  <span className="text-xs font-bold text-yellow-700">
                    {BADGE_NAMES[key] ?? key}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* XP progress bar */}
        {level_info && (
          <div className="mb-3">
            <div className="h-2 rounded-full bg-blue-50 border border-blue-100 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${level_info.progress_pct}%` }}
              />
            </div>
            {level_info.next_level_xp && (
              <div className="text-xs text-gray-400 text-right mt-0.5">
                距下一級 {level_info.xp_to_next} XP
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => {
            setVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="w-full text-sm text-blue-600 font-medium py-1 hover:text-blue-700"
        >
          繼續
        </button>
      </div>
    </div>
  );
};

export default XPAwardToast;
