/**
 * StudentPkQueueWait — `/pk/queue/:queueId` (PRD §3.1 step 4, §9.1, §9.2,
 * §18 #3).
 *
 * "改挑戰文學家" is visible and clickable from the FIRST second, not
 * revealed after a delay. At 10s the button gets a visual nudge (color +
 * pulse) — never a countdown number ("倒數數字會讓人誤以為時間到了會自動
 *發生"), and the server NEVER auto-creates a match on its own.
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { cancelPkQueue, pollPkQueue, PkApiError, type PkScopeType } from '../../services/pkApi';

const POLL_INTERVAL_MS = 1000;

interface LocationState {
  scopeType?: PkScopeType;
  scopeRef?: string;
  classroomId?: number | null;
}

const StudentPkQueueWait: React.FC = () => {
  const { queueId } = useParams<{ queueId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as LocationState) ?? {};

  const [suggestAi, setSuggestAi] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!token || !queueId) return undefined;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await pollPkQueue(token, Number(queueId));
        if (cancelled) return;
        setSuggestAi(res.suggest_ai);
        if (res.status === 'matched' && res.match_id != null) {
          navigate(`/pk/match/${res.match_id}`, { replace: true, state: { opponentType: 'player' } });
          return;
        }
        if (res.status === 'cancelled' || res.status === 'expired') {
          navigate('/pk', { replace: true });
          return;
        }
        timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof PkApiError ? err.message : '連線失敗，重新嘗試中…');
        timer = window.setTimeout(poll, POLL_INTERVAL_MS * 2);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [token, queueId, navigate]);

  const handleCancel = async () => {
    if (!token || !queueId || cancelling) return;
    setCancelling(true);
    try {
      await cancelPkQueue(token, Number(queueId));
    } finally {
      navigate('/pk', { replace: true });
    }
  };

  const handleSwitchToAi = async () => {
    if (!token || !queueId || cancelling) return;
    setCancelling(true);
    try {
      await cancelPkQueue(token, Number(queueId));
    } finally {
      const qs = new URLSearchParams({
        scopeType: locState.scopeType ?? 'grade_pool',
        scopeRef: locState.scopeRef ?? '',
        ...(locState.classroomId != null ? { classroomId: String(locState.classroomId) } : {}),
      });
      navigate(`/pk/opponents?${qs.toString()}`, { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
      <div className="mb-6 h-12 w-12 animate-spin rounded-full border-4 border-accent border-t-transparent" aria-hidden="true" />
      <h1 className="text-lg font-bold text-on-surface">正在尋找同學…</h1>
      <p className="mt-1 text-sm text-on-surface-variant">配到人馬上開始，或是先去挑戰一位文學家</p>
      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      <div className="mt-10 flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={() => void handleSwitchToAi()}
          className={[
            'rounded-full px-6 py-3 text-base font-bold transition-colors active:scale-95',
            suggestAi ? 'bg-accent text-white animate-pulse' : 'border-2 border-accent text-accent',
          ].join(' ')}
        >
          要不要挑戰一位文學家？
        </button>
        <button
          type="button"
          onClick={() => void handleCancel()}
          className="rounded-full px-6 py-3 text-base font-medium text-on-surface-variant active:scale-95"
        >
          取消
        </button>
      </div>
    </div>
  );
};

export default StudentPkQueueWait;
