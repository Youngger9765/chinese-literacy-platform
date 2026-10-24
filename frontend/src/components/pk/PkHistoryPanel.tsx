/**
 * PkHistoryPanel — "過去的戰績表現" (#3747: Young asked for this on the PK
 * entry screen). The backend has carried `/api/pk/history` and
 * `/api/pk/rating/me` since #3586/#3602 — no migration needed, this is
 * purely a missing frontend consumer (see pkApi.ts: `getPkHistory` /
 * `getPkRatingMe` were exported but never imported anywhere outside this
 * file and its test).
 *
 * Best-effort, never blocks the entry screen: a fetch failure renders
 * nothing (same pattern as StudentOurClassPage's season-board fetch) —
 * this panel is a bonus, not the page's primary job (finding an opponent).
 */
import React, { useEffect, useState } from 'react';
import { getPkHistory, getPkRatingMe, type PkHistoryEntry } from '../../services/pkApi';
import { getPkFigure } from '../../data/pkFigures';

interface PkRatingSummary {
  rating: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
}

interface PkHistoryPanelProps {
  token: string;
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

const PkHistoryPanel: React.FC<PkHistoryPanelProps> = ({ token }) => {
  const [rating, setRating] = useState<PkRatingSummary | null>(null);
  const [matches, setMatches] = useState<PkHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPkRatingMe(token), getPkHistory(token)])
      .then(([r, h]) => {
        if (cancelled) return;
        setRating(r);
        // Only count completed matches as "戰績" — an abandoned/active row
        // has no outcome yet and would otherwise show a confusing blank.
        setMatches(h.matches.filter((m) => m.status === 'completed'));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed) return null;

  if (matches == null) {
    return (
      <div
        className="mt-6 h-24 w-full max-w-sm animate-pulse rounded-2xl bg-surface-container"
        aria-hidden="true"
        data-testid="pk-history-panel-loading"
      />
    );
  }

  if (matches.length === 0) {
    return (
      <div
        className="mt-6 w-full max-w-sm rounded-2xl bg-surface-container-lowest px-4 py-4 text-center text-sm text-on-surface-variant shadow-sm"
        data-testid="pk-history-panel"
      >
        還沒有對戰紀錄，去挑戰第一場吧！
      </div>
    );
  }

  const recent = matches.slice(0, MAX_RECENT);

  return (
    <div
      className="mt-6 w-full max-w-sm rounded-2xl bg-surface-container-lowest p-4 shadow-sm"
      data-testid="pk-history-panel"
    >
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
