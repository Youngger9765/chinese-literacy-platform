/**
 * StudentGameHubPage — `/game-hub` (issue #3633, issue #3756 round 2).
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
 * #3756: the flat 5-card grid gave no signal about WHICH of the two very
 * different things a student is about to do — "I can start this myself
 * right now" vs "this needs a teacher to open it or classmates to join".
 * `classroomGated` (gameModes.ts) is NOT that distinction (team_arena has
 * no classroom switch at all, yet still needs classmates in the room) —
 * `SECTION_OF` below is a deliberate product grouping, not derived from
 * the registry's gating flags. Old routes are untouched — this page is a
 * new front door, not a replacement for /student/our-class, /live, /pk,
 * /escape-room.
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

/** #3756: which of the two hub sections each mode belongs in, plus the
 * one-line "start condition" badge shown on every card of that mode
 * regardless of its current lock state (unlike `lockedText`, which only
 * appears while actually locked — a 課堂搶答 card the teacher HAS turned
 * on still needs a live code from them, so "需要老師開始" stays true). */
type Section = 'self' | 'class';
const SECTION_OF: Record<GameModeKey, Section> = {
  pk_human: 'self',
  escape_room: 'self',
  live_quiz: 'class',
  team_arena: 'class',
  league: 'class',
};
const START_CONDITION: Record<GameModeKey, string> = {
  pk_human: '隨時可玩',
  escape_room: '隨時可玩',
  live_quiz: '需要老師開始',
  team_arena: '找同學一起',
  league: '需要老師開始',
};
const SECTION_COPY: Record<Section, { title: string; subtitle: string }> = {
  self: { title: '自己玩', subtitle: '不用等任何人，現在就能開始' },
  class: { title: '跟班上一起玩', subtitle: '要老師開始，或找同學一起' },
};

interface GameHubCard {
  key: string;
  label: string;
  description: string;
  path: string | null;
  locked: boolean;
  lockedText: string;
  startCondition: string;
  section: Section;
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
      {/* #3756: informational "when can I start this" badge — independent
          of lock state (see START_CONDITION docstring above). Shown
          whenever the card is not locked; the lockedText badge below
          already covers the locked case so the two never stack. */}
      {!card.locked && (
        <span className="mt-1 text-[11px] font-medium text-accent bg-accent-bg rounded-full px-2 py-0.5">
          {card.startCondition}
        </span>
      )}
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
    startCondition: START_CONDITION[mode.key],
    section: SECTION_OF[mode.key],
    ...DECORATIONS[mode.key],
  }));

  // #3756: split into the two sections, but keep GAME_MODES' own relative
  // order within each section (no extra sort) so this stays a pure
  // regrouping, not a re-prioritization.
  const selfPlayCards = cards.filter((c) => c.section === 'self');
  const classPlayCards = cards.filter((c) => c.section === 'class');

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">遊戲區</h1>
      <p className="text-sm text-gray-500 mb-6">挑一個玩法，開始闖關</p>

      <section aria-labelledby="game-hub-section-self" className="mb-8">
        <h2 id="game-hub-section-self" className="text-base font-bold text-gray-900">
          {SECTION_COPY.self.title}
        </h2>
        <p className="text-xs text-gray-500 mb-3">{SECTION_COPY.self.subtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {selfPlayCards.map((card) => (
            <GameHubCardButton
              key={card.key}
              card={card}
              onOpen={() => card.path && navigate(card.path)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="game-hub-section-class">
        <h2 id="game-hub-section-class" className="text-base font-bold text-gray-900">
          {SECTION_COPY.class.title}
        </h2>
        <p className="text-xs text-gray-500 mb-3">{SECTION_COPY.class.subtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {classPlayCards.map((card) => (
            <GameHubCardButton
              key={card.key}
              card={card}
              onOpen={() => card.path && navigate(card.path)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

export default StudentGameHubPage;
