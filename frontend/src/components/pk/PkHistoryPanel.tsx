/**
 * PkHistoryPanel — "過去的戰績表現" (#3747: Young asked for this on the PK
 * entry screen). The backend has carried `/api/pk/history` and
 * `/api/pk/rating/me` since #3586/#3602 — no migration needed, this is
 * purely a missing frontend consumer (see pkApi.ts: `getPkHistory` /
 * `getPkRatingMe` were exported but never imported anywhere outside this
 * file and its test).
 *
 * #3761 round 3 (Young: "戰績區即使沒紀錄也要有像樣的空狀態（例：七位文學
 * 家的擊敗進度 0/7，用頭像灰階表示未擊敗）"): added the "N/7 位文學家已
 * 擊敗" roster, reusing `getPkOpponents` — that endpoint already returns
 * `icon_url` + `unlocked` per figure for the opponent-select screen
 * (`StudentPkOpponentSelect.tsx`), so this is another "後端已有資料就做"
 * case, not a new endpoint. The roster renders in BOTH the empty and
 * populated states (a student with 0 matches has just as much use for "0/7
 * 擊敗" as one with 3 wins has for "3/7 擊敗" — it's not conditional on
 * history existing).
 *
 * round 4 (Young reviewed round 3's screenshots: "桌機請把戰績/七位文學家
 * 進度放大成可點的頭像卡牆"): the roster is now a bigger grid of clickable
 * avatar cards (name + locked/unlocked state), each navigating to the
 * opponent-select screen via `onChallenge` — and each avatar now goes
 * through the shared `PkFigureAvatar` (reading `slug` directly) instead of
 * the API's own `icon_url` field, so it upgrades to real art the moment
 * pk-avatars' PNGs land, same as `PkHeroBanner`'s figures — no longer two
 * separate avatar code paths that would each need updating by hand.
 *
 * Best-effort, never blocks the entry screen: this panel is a bonus, not
 * the page's primary job (finding an opponent). "Never blocks" means each
 * of the three calls (rating / history / opponents) degrades on its own —
 * one failing doesn't hide data the others already fetched successfully.
 * Only total failure (all three reject) renders nothing (same pattern as
 * StudentOurClassPage's season-board fetch). See #3766: this used to be
 * `Promise.all`, which made ANY single rejection blank the whole panel —
 * including an already-loaded roster that has nothing to do with whatever
 * failed — the opposite of "best-effort".
 */
import React, { useEffect, useState } from 'react';
import { getPkHistory, getPkRatingMe, getPkOpponents, type PkHistoryEntry, type PkOpponent } from '../../services/pkApi';
import { getPkFigure } from '../../data/pkFigures';
import PkFigureAvatar from './PkFigureAvatar';

interface PkRatingSummary {
  rating: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
}

interface PkHistoryPanelProps {
  token: string;
  /** Navigates to the opponent-select screen — same handler the page's
   * own "挑戰文學家" button uses. There is no per-figure deep link (no
   * API/route takes "start a match against tier N" directly), so every
   * roster card leads to the same picker rather than straight into a
   * match — "可點" means "takes you to pick", not "instantly challenges
   * this exact figure". */
  onChallenge: () => void;
}

type Outcome = 'win' | 'loss' | 'draw';

const OUTCOME_BADGE: Record<Outcome, { text: string; cls: string }> = {
  win: { text: '勝', cls: 'text-success bg-success/10' },
  loss: { text: '負', cls: 'text-tertiary bg-tertiary-container/40' },
  draw: { text: '平', cls: 'text-on-surface-variant bg-surface-container' },
};

const MAX_RECENT = 5;

function opponentLabel(m: PkHistoryEntry): string {
  if (m.opponent_type === 'AI' && m.bot_tier != null) {
    return getPkFigure(m.bot_tier)?.name ?? 'AI';
  }
  return '同學';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

/** #3761 round 4: the "N/7 位文學家已擊敗" roster — a grid of clickable
 * avatar CARDS (avatar + name), not a thin inline strip of bare icons. */
const DefeatRoster: React.FC<{ opponents: PkOpponent[]; onChallenge: () => void }> = ({ opponents, onChallenge }) => {
  if (opponents.length === 0) return null;
  const unlockedCount = opponents.filter((o) => o.unlocked).length;
  return (
    <div className="mb-4" data-testid="pk-defeat-roster">
      <p className="mb-2 text-sm font-medium text-on-surface-variant">
        {unlockedCount}/{opponents.length} 位文學家已擊敗
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {opponents.map((o) => (
          <button
            key={o.tier}
            type="button"
            onClick={onChallenge}
            title={o.unlocked ? `${o.name}（已擊敗）` : `${o.name}（尚未擊敗，點擊挑戰）`}
            className="flex flex-col items-center gap-1 rounded-xl p-2 transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <PkFigureAvatar slug={o.slug} name={o.name} size="lg" locked={!o.unlocked} />
            <span className={`text-xs font-medium ${o.unlocked ? 'text-on-surface' : 'text-on-surface-variant'}`}>
              {o.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

const PkHistoryPanel: React.FC<PkHistoryPanelProps> = ({ token, onChallenge }) => {
  const [rating, setRating] = useState<PkRatingSummary | null>(null);
  const [matches, setMatches] = useState<PkHistoryEntry[] | null>(null);
  const [opponents, setOpponents] = useState<PkOpponent[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // #3766 (Young, staging repro: a classroom-enrolled student with
    // real-PK turned on saw NO "N/7 已擊敗" roster and NO 戰績 — just a
    // blank strip below the buttons, even though the roster's own data
    // (`getPkOpponents`) has nothing to do with rating/history). Root
    // cause: `Promise.all` makes these three INDEPENDENT calls succeed or
    // fail as one unit — any single rejection (here, apparently rating or
    // history, on that specific staging account; never reproducible
    // locally against a fresh classroom+pk_human student, see issue #3766
    // for what was and wasn't verifiable) blanked the whole panel,
    // including a roster that had already loaded fine. That directly
    // contradicts this file's own "best-effort, never blocks" docstring —
    // the three calls were wired as all-or-nothing when the data they
    // feed isn't. `Promise.allSettled` lets each piece degrade on its
    // own: the roster shows whenever `opponents` resolves, independent of
    // whether rating/history came back. Only true total failure (all
    // three reject) falls through to the old "render nothing" behavior.
    Promise.allSettled([getPkRatingMe(token), getPkHistory(token), getPkOpponents(token)]).then(
      ([ratingResult, historyResult, opponentsResult]) => {
        if (cancelled) return;
        if (ratingResult.status === 'fulfilled') setRating(ratingResult.value);
        if (historyResult.status === 'fulfilled') {
          // Only count completed matches as "戰績" — an abandoned/active
          // row has no outcome yet and would otherwise show a confusing
          // blank.
          setMatches(historyResult.value.matches.filter((m) => m.status === 'completed'));
        } else {
          // History failed but something else may have succeeded — treat
          // "we don't know your history" the same as "no history yet"
          // rather than leaving `matches` stuck at `null` forever (which
          // would pin the loading skeleton indefinitely instead of
          // reaching the roster's render path).
          setMatches([]);
        }
        if (opponentsResult.status === 'fulfilled') setOpponents(opponentsResult.value.opponents);
        const allFailed = [ratingResult, historyResult, opponentsResult].every(
          (r) => r.status === 'rejected',
        );
        if (allFailed) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed) return null;

  if (matches == null) {
    return (
      <div
        className="mt-6 h-24 w-full max-w-3xl animate-pulse rounded-2xl bg-surface-container"
        aria-hidden="true"
        data-testid="pk-history-panel-loading"
      />
    );
  }

  if (matches.length === 0) {
    return (
      <div
        className="mt-6 w-full max-w-3xl rounded-2xl bg-surface-container-lowest p-4 shadow-sm sm:p-6"
        data-testid="pk-history-panel"
      >
        <DefeatRoster opponents={opponents} onChallenge={onChallenge} />
        <p className="text-center text-sm text-on-surface-variant">還沒有對戰紀錄，去挑戰第一場吧！</p>
      </div>
    );
  }

  const recent = matches.slice(0, MAX_RECENT);

  return (
    <div
      className="mt-6 w-full max-w-3xl rounded-2xl bg-surface-container-lowest p-4 shadow-sm sm:p-6"
      data-testid="pk-history-panel"
    >
      <DefeatRoster opponents={opponents} onChallenge={onChallenge} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-on-surface">我的戰績</h2>
        {rating && <span className="text-xs text-on-surface-variant">積分 {rating.rating}</span>}
      </div>

      {rating && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-success/10 py-1.5">
            <span className="font-bold text-success">{rating.wins}</span> 勝
          </div>
          <div className="rounded-lg bg-tertiary-container/40 py-1.5">
            <span className="font-bold text-tertiary">{rating.losses}</span> 負
          </div>
          <div className="rounded-lg bg-surface-container py-1.5">
            <span className="font-bold text-on-surface-variant">{rating.draws}</span> 平
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {recent.map((m) => {
          const outcome: Outcome = m.outcome ?? 'draw';
          const badge = OUTCOME_BADGE[outcome];
          return (
            <li key={m.match_id} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-on-surface-variant">
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${badge.cls}`}>{badge.text}</span>
                <span className="truncate">vs {opponentLabel(m)}</span>
              </span>
              <span className="shrink-0 tabular-nums text-on-surface">
                {m.my_score} : {m.opponent_score}
              </span>
              <span className="shrink-0 text-on-surface-variant">{formatDate(m.completed_at ?? m.started_at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PkHistoryPanel;
