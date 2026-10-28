/**
 * StudentGameHubPage — `/game-hub` (issue #3633, #3756, #3761 round 3).
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
 * the registry's gating flags.
 *
 * #3761 (Young, round 3 after reviewing #3756's screenshots): "卡片小、
 * 畫面大半空白；emoji 跟角色插畫風格不一致" — every card below now has a
 * full-height illustrated hero image (either an existing character
 * portrait, or one of the three new codex image_gen icons committed under
 * `story-assets/{live-quiz,escape-room,team-arena}-hub/`), a per-mode
 * gradient backdrop, and the desktop grid now widens self-play to 2 large
 * columns and class-play to 3, instead of the old generic 1/2/3 grid that
 * left the same small-icon cards whether there were 2 or 5 of them. Old
 * routes are untouched — this page is a new front door, not a replacement
 * for /student/our-class, /live, /pk, /escape-room.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyEnrolledClassrooms, computeStudentGameFlags } from '../../services/learning/session';
import { getStudentProgress } from '../../services/progressApi';
import { fetchMyWordBabies } from '../../services/wordBabyApi';
import { occupiedCountFromProgress } from './archipelagoDomain';
import { GAME_MODES, type GameModeKey } from '../../data/gameModes';

/** #3761: one illustrated hero image per mode + a matching gradient
 * backdrop so the card reads as a small "poster" instead of a tiny icon on
 * white. PK reuses 李白's existing full-portrait (`portrait-idle.png`,
 * already committed under story-assets/pk-li-bai/ since #3745) instead of
 * the 128x128 icon the old hub card used — same asset, just a bigger
 * cousin of it, not a new generation. 跨班賽季 reuses the guide's
 * "greet" full-body pose (already committed) the same way. The other
 * three are new codex image_gen icons for THIS issue (prompts recorded in
 * each folder's `_prompts.json`), replacing the old generic emoji. */
const HERO: Record<GameModeKey, { src: string; gradient: string }> = {
  pk_human: { src: '/story-assets/pk-li-bai/portrait-idle.png', gradient: 'from-[#8B7FD1] to-[#6D5BD0]' },
  escape_room: { src: '/story-assets/escape-room-hub/icon.png', gradient: 'from-[#6D5BD0] to-[#4B3F99]' },
  live_quiz: { src: '/story-assets/live-quiz-hub/icon.png', gradient: 'from-[#F0624D] to-[#D63B2F]' },
  team_arena: { src: '/story-assets/team-arena-hub/icon.png', gradient: 'from-[#1FA6A6] to-[#E0792B]' },
  league: { src: '/story-assets/league-tang/guide-changan-greet.png', gradient: 'from-[#6D7B8F] to-[#4A5568]' },
};

/** #3761: punchier, more inviting one-liners (same facts as #3756's plain
 * descriptions — nothing here claims a feature that doesn't exist). Kept
 * in this page rather than editing `gameModes.ts`'s `description` field,
 * even though that field IS the single source for this exact card's copy
 * (its own docstring says so) — the registry's `description` is reused
 * verbatim by `frontend/src/data/__tests__/gameModes.test.ts`'s pinned
 * string test and read by nothing else, so changing it here keeps the
 * blast radius to this one file instead of a cross-cutting rename. */
const TAGLINE: Record<GameModeKey, string> = {
  pk_human: '一對一尬題，向同學或文學家下戰帖',
  escape_room: '闖關解謎，和書中夥伴一起逃出迷霧',
  live_quiz: '全班一起搶答，看誰反應最快',
  team_arena: '組隊攻城，合力推倒對方城塔',
  league: '跨班巡迴賽，讀課文就在幫班上加分',
};

const LOCKED_TEXT = '老師尚未開啟';

/** #3780 D1（PRD §5.7）：「島嶼探索」卡——跟 GAME_MODES 其他卡同一套 hero
 * 圖＋漸層視覺風格，但不是「遊戲模式」（沒有教室開關、沒有後端 modes.py
 * 對應項），所以不塞進那個註冊表，走自己獨立的卡片。hero 圖沿用喝采島
 * 冷開場既有插畫（`op1.jpg`，不是新生成的美術），深夜海面配色自成一組
 * 漸層，跟其他五張卡（紫/深紫/紅/青橘/灰）不撞色。*/
const ISLAND_HERO = { src: '/lab-island/opening/op1.jpg', gradient: 'from-[#1B3A5C] to-[#0B1E33]' };

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
  key: GameModeKey;
  label: string;
  tagline: string;
  path: string | null;
  locked: boolean;
  lockedText: string;
  startCondition: string;
  section: Section;
  heroSrc: string;
  heroGradient: string;
}

/** #3761: large "poster" card — hero image fills the top ~60%, title +
 * tagline + badge sit on a solid panel below so text stays readable
 * regardless of what's happening in the illustration above it. */
const GameHubCardButton: React.FC<{ card: GameHubCard; onOpen: () => void; size: 'lg' | 'md' }> = ({
  card,
  onOpen,
  size,
}) => {
  const disabled = card.locked || !card.path;
  const heroHeight = size === 'lg' ? 'h-48 sm:h-56' : 'h-40 sm:h-44';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={card.locked ? `${card.label}（${card.lockedText}）` : card.label}
      className={`
        group flex flex-col overflow-hidden rounded-3xl border text-left shadow-sm transition-all
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
        ${disabled
          ? 'border-gray-200 opacity-60 cursor-not-allowed'
          : 'border-gray-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer'
        }
      `}
    >
      <div
        className={`relative flex ${heroHeight} items-end justify-center bg-gradient-to-br ${card.heroGradient} ${
          disabled ? 'grayscale' : ''
        }`}
      >
        <img
          src={card.heroSrc}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain p-3 drop-shadow-md"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 bg-white px-4 py-3">
        <span className="text-lg font-bold text-gray-900">{card.label}</span>
        <span className="text-sm text-gray-500">{card.tagline}</span>
        {/* #3756: informational "when can I start this" badge — independent
            of lock state (see START_CONDITION docstring above). Shown
            whenever the card is not locked; the lockedText badge below
            already covers the locked case so the two never stack. */}
        {!card.locked && (
          <span className="mt-1 w-fit text-[11px] font-medium text-accent bg-accent-bg rounded-full px-2 py-0.5">
            {card.startCondition}
          </span>
        )}
        {card.locked && (
          <span className="mt-1 w-fit text-[11px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
            {card.lockedText}
          </span>
        )}
      </div>
    </button>
  );
};

/** #3780 D1：「島嶼探索」卡，視覺上刻意跟 `GameHubCardButton` 共用同一套
 * class（hero 滿版圖＋下方白底文字區＋「隨時可玩」徽章），但資料是動態的
 * （已佔領島數、文字寶貝數），不是靜態 tagline，所以沒有重用那個元件本身
 * （它的 props 綁死在 `GAME_MODES` 註冊表的型別上）。 */
const IslandExplorationCard: React.FC<{
  occupied: number | null;
  babyCount: { owned: number; total: number } | null;
  onOpen: () => void;
}> = ({ occupied, babyCount, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label="島嶼探索"
    className="group flex flex-col overflow-hidden rounded-3xl border border-gray-200 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
  >
    <div className={`relative flex h-48 items-end justify-center bg-gradient-to-br ${ISLAND_HERO.gradient} sm:h-56`}>
      <img src={ISLAND_HERO.src} alt="" aria-hidden="true" className="h-full w-full object-cover" />
    </div>
    <div className="flex flex-1 flex-col gap-1 bg-white px-4 py-3">
      <span className="text-lg font-bold text-gray-900">島嶼探索</span>
      <span className="text-sm text-gray-500">
        {occupied === null ? '已佔領島嶼載入中…' : `已佔領 ${occupied} 座島`}
        {'、文字寶貝 '}
        {babyCount === null ? '載入中…' : `${babyCount.owned} 隻`}
      </span>
      <span className="mt-1 w-fit rounded-full bg-accent-bg px-2 py-0.5 text-[11px] font-medium text-accent">
        隨時可玩
      </span>
    </div>
  </button>
);

const StudentGameHubPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [occupied, setOccupied] = useState<number | null>(null);
  const [babyCount, setBabyCount] = useState<{ owned: number; total: number } | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let alive = true;
    getStudentProgress(token, user.id)
      .then((res) => { if (alive) setOccupied(occupiedCountFromProgress(res.texts)); })
      .catch(() => { /* best-effort — card shows a loading label if this fails */ });
    fetchMyWordBabies(user.id, token)
      .then((res) => { if (alive) setBabyCount({ owned: res.babies_owned_count, total: res.babies_total_species }); })
      .catch(() => { /* best-effort */ });
    return () => { alive = false; };
  }, [token, user]);
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
    tagline: TAGLINE[mode.key],
    path: mode.hubRoute,
    locked: lockState[mode.key] ?? false,
    lockedText: lockState[mode.key] ? LOCKED_TEXT : '',
    startCondition: START_CONDITION[mode.key],
    section: SECTION_OF[mode.key],
    heroSrc: HERO[mode.key].src,
    heroGradient: HERO[mode.key].gradient,
  }));

  // #3756: split into the two sections, but keep GAME_MODES' own relative
  // order within each section (no extra sort) so this stays a pure
  // regrouping, not a re-prioritization.
  const selfPlayCards = cards.filter((c) => c.section === 'self');
  const classPlayCards = cards.filter((c) => c.section === 'class');

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">遊戲區</h1>
      <p className="text-sm text-gray-500 mb-6">挑一個玩法，開始闖關</p>

      <section aria-labelledby="game-hub-section-self" className="mb-10">
        <h2 id="game-hub-section-self" className="text-base font-bold text-gray-900">
          {SECTION_COPY.self.title}
        </h2>
        <p className="text-xs text-gray-500 mb-3">{SECTION_COPY.self.subtitle}</p>
        {/* #3761: desktop keeps these 2 cards LARGE side-by-side (not a
            3-up grid that would leave a half-empty row for only 2 items). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {selfPlayCards.map((card) => (
            <GameHubCardButton
              key={card.key}
              card={card}
              size="lg"
              onOpen={() => card.path && navigate(card.path)}
            />
          ))}
          <IslandExplorationCard
            occupied={occupied}
            babyCount={babyCount}
            onOpen={() => navigate('/student/archipelago')}
          />
        </div>
      </section>

      <section aria-labelledby="game-hub-section-class">
        <h2 id="game-hub-section-class" className="text-base font-bold text-gray-900">
          {SECTION_COPY.class.title}
        </h2>
        <p className="text-xs text-gray-500 mb-3">{SECTION_COPY.class.subtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {classPlayCards.map((card) => (
            <GameHubCardButton
              key={card.key}
              card={card}
              size="md"
              onOpen={() => card.path && navigate(card.path)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

export default StudentGameHubPage;
