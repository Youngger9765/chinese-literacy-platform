/**
 * StudentGameHubPage — `/game-hub` (issue #3633).
 *
 * One card per game mode, replacing the three scattered sidebar entries
 * (我們班/課堂搶答/PK 對戰) this issue consolidates, and finally giving
 * 迷城密室 a way in: it has had a working page at /escape-room since #3599
 * but NO sidebar entry anywhere, so students could never reach it through
 * navigation at all — that is the bug this issue exists to fix.
 *
 * Locking rule is identical to the pre-#3633 sidebar (#3607, computed via
 * the shared `computeStudentGameFlags` — see services/learning/session.ts
 * for why that logic lives there instead of being re-derived here):
 * 跨班賽季 and 課堂搶答 stay locked ("老師尚未開啟") until ANY of the
 * student's enrolled classrooms has the corresponding flag on. PK 對戰、
 * 迷城密室、and 多人對抗賽 (issue #3632 v2: "拿掉班級開關") are never
 * classroom-gated — all three are always available to any logged-in
 * student regardless of class or class settings.
 *
 * Old routes are untouched — this page is a new front door, not a
 * replacement for /student/our-class, /live, /pk, /escape-room.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyEnrolledClassrooms, computeStudentGameFlags } from '../../services/learning/session';
import { GAME_MODES, type GameModeKey } from '../../data/gameModes';

/** Visual-only decoration per mode (icon + lock copy) — not part of the
 * shared `GAME_MODES` registry because it's purely cosmetic / this page's
 * own concern, unlike label/description/route which other consumers could
 * plausibly need too. Keyed by the same `GameModeKey` so a new registry
 * entry with no decoration here falls back to the generic emoji default
 * below rather than crashing. */
const DECORATIONS: Partial<Record<GameModeKey, { imageSrc?: string; emoji?: string }>> = {
  league: { imageSrc: '/story-assets/league-tang/guide-changan-icon.png' },
  live_quiz: { emoji: '🎮' },
  pk_human: { imageSrc: '/story-assets/pk-li-bai/icon.png' },
  escape_room: { emoji: '🏰' },
  team_arena: { emoji: '🛡️' },
};

const LOCKED_TEXT = '老師尚未開啟';

interface GameHubCard {
  key: string;
  label: string;
  description: string;
  path: string | null;
  locked: boolean;
  lockedText: string;
  imageSrc?: string;
  emoji?: string;
}

const GameHubCardButton: React.FC<{ card: GameHubCard; onOpen: () => void }> = ({ card, onOpen }) => {
  const disabled = card.locked || !card.path;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={card.locked ? `${card.label}（${card.lockedText}）` : card.label}
      className={`
        flex flex-col items-center gap-2 rounded-2xl border p-5 text-center transition-all
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
        ${disabled
          ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
          : 'border-gray-200 bg-white hover:border-accent hover:shadow-md cursor-pointer'
        }
      `}
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 ${
          disabled ? 'bg-gray-200' : 'bg-accent-bg'
        }`}
        aria-hidden="true"
      >
        {card.imageSrc ? (
          <img
            src={card.imageSrc}
            alt=""
            className={`w-12 h-12 object-contain ${disabled ? 'grayscale' : ''}`}
          />
        ) : (
          <span className="text-3xl">{card.emoji}</span>
        )}
      </div>
      <span className="text-base font-semibold text-gray-900">{card.label}</span>
      <span className="text-xs text-gray-500">{card.description}</span>
      {card.locked && (
        <span className="mt-1 text-[11px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
          {card.lockedText}
        </span>
      )}
    </button>
  );
};

const StudentGameHubPage: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  // Default false (locked) until the real enrollment data loads — same
  // fail-safe default Sidebar.tsx used pre-consolidation (#3607): a
  // feature the student can't use is never flashed as unlocked before
  // disappearing again.
  const [leagueEnabled, setLeagueEnabled] = useState(false);
  const [liveQuizEnabled, setLiveQuizEnabled] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        const flags = computeStudentGameFlags(res.classrooms);
        setLeagueEnabled(flags.league);
        setLiveQuizEnabled(flags.liveQuiz);
      })
      .catch(() => {
        /* best-effort — cards simply stay locked if this fails */
      });
  }, [token]);

  // Lock state per mode — ONLY league/live_quiz ever lock the whole hub
  // entry (see data/gameModes.ts and backend game_core/modes.py's
  // docstring for why `classroomGated` is not the same question: pk_human
  // has a classroom switch too, but its hub card never locks because AI
  // PK inside it is always reachable). A new classroom-gated mode that
  // DOES want its whole hub card to lock would be added here explicitly,
  // not inferred from `classroomGated` alone.
  const lockState: Partial<Record<GameModeKey, boolean>> = {
    league: !leagueEnabled,
    live_quiz: !liveQuizEnabled,
  };

  const cards: GameHubCard[] = GAME_MODES.map((mode) => ({
    key: mode.key,
    label: mode.label,
    description: mode.description,
    path: mode.hubRoute,
    locked: lockState[mode.key] ?? false,
    lockedText: lockState[mode.key] ? LOCKED_TEXT : '',
    ...DECORATIONS[mode.key],
  }));

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">遊戲區</h1>
      <p className="text-sm text-gray-500 mb-6">挑一個玩法，開始闖關</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <GameHubCardButton
            key={card.key}
            card={card}
            onOpen={() => card.path && navigate(card.path)}
          />
        ))}
      </div>
    </div>
  );
};

export default StudentGameHubPage;
