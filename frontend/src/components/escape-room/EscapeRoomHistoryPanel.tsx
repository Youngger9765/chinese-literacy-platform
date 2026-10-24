/**
 * EscapeRoomHistoryPanel — "我的挑戰紀錄" (#3756, sibling of `PkHistoryPanel`
 * on the PK entry screen — same "後端已有資料就做" reasoning: `EscapeRoomRun`
 * already carries `result`/`started_at`/`completed_at` per student, so
 * `getEscapeRoomHistory` is a read-only addition, not a new migration; see
 * `backend/app/services/escape_room/engine.py`'s `list_history` docstring).
 *
 * Best-effort, never blocks the entry screen: a fetch failure renders
 * nothing (same pattern PkHistoryPanel uses) — a student who has never
 * played must not be shown an error, only silence or the empty state.
 */
import React, { useEffect, useState } from 'react';
import { getEscapeRoomHistory, type EscapeRoomHistoryEntry } from '../../services/escapeRoomApi';

interface EscapeRoomHistoryPanelProps {
  token: string;
}

const RESULT_BADGE: Record<EscapeRoomHistoryEntry['result'], { text: string; cls: string }> = {
  escaped: { text: '逃出', cls: 'text-success bg-success/10' },
  not_this_time: { text: '沒逃出', cls: 'text-tertiary bg-tertiary-container/40' },
  abandoned: { text: '中途離開', cls: 'text-on-surface-variant bg-surface-container' },
  in_progress: { text: '進行中', cls: 'text-accent bg-accent-bg' },
};

const MAX_RECENT = 5;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

const EscapeRoomHistoryPanel: React.FC<EscapeRoomHistoryPanelProps> = ({ token }) => {
  const [runs, setRuns] = useState<EscapeRoomHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEscapeRoomHistory(token)
      .then((res) => {
        if (!cancelled) setRuns(res.runs);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failed) return null;

  if (runs == null) {
    return (
      <div
        className="mt-6 h-20 w-full max-w-sm animate-pulse rounded-2xl bg-surface-container"
        aria-hidden="true"
        data-testid="escape-room-history-panel-loading"
      />
    );
  }

  if (runs.length === 0) {
    return (
      <div
        className="mt-6 w-full max-w-sm rounded-2xl bg-surface-container-lowest px-4 py-4 text-center text-sm text-on-surface-variant shadow-sm"
        data-testid="escape-room-history-panel"
      >
        還沒有挑戰紀錄，去探索第一次吧！
      </div>
    );
  }

  const recent = runs.slice(0, MAX_RECENT);
  const escapedCount = runs.filter((r) => r.result === 'escaped').length;

  return (
    <div
      className="mt-6 w-full max-w-sm rounded-2xl bg-surface-container-lowest p-4 shadow-sm"
      data-testid="escape-room-history-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-on-surface">我的挑戰紀錄</h2>
        <span className="text-xs text-on-surface-variant">共逃出 {escapedCount} 次</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {recent.map((run) => {
          const badge = RESULT_BADGE[run.result];
          const duration = formatDuration(run.duration_seconds);
          return (
            <li
              key={run.run_id}
              className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-on-surface-variant">
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${badge.cls}`}>{badge.text}</span>
                {duration && <span className="truncate">用時 {duration}</span>}
              </span>
              <span className="shrink-0 text-on-surface-variant">
                {formatDate(run.completed_at ?? run.started_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default EscapeRoomHistoryPanel;
