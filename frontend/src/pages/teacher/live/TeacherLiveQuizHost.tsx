/**
 * TeacherLiveQuizHost — the fullscreen host/projector page, orchestrating
 * setup → lobby → question → reveal → podium by polling /state and
 * dispatching on `state.status`.
 *
 * Deliberately NOT wrapped in AppShell (PRD §9 item 9: "投影頁全螢幕，不套
 * 原本的頁面外框") — see AppRoutes.tsx, same pattern as LearningAppShell's
 * guest route.
 */
import React, { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useLiveQuizPoll } from '../../../components/live-quiz/useLiveQuizPoll';
import {
  getHostDeviceId,
  startLiveQuizGame,
  revealLiveQuizRound,
  nextLiveQuizRound,
  endLiveQuizGame,
  isValidLiveQuizCode,
  LiveQuizApiError,
} from '../../../services/liveQuizApi';
import TeacherLiveQuizSetup from './TeacherLiveQuizSetup';
import TeacherLiveQuizLobby from './TeacherLiveQuizLobby';
import TeacherLiveQuizQuestion from './TeacherLiveQuizQuestion';
import TeacherLiveQuizReveal from './TeacherLiveQuizReveal';
import TeacherLiveQuizPodium from './TeacherLiveQuizPodium';

const TeacherLiveQuizHost: React.FC = () => {
  const { code: routeCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [takeoverPrompt, setTakeoverPrompt] = useState<(() => void) | null>(null);

  // routeCode is a raw URL segment (`/teacher/live/:code`) — never hand an
  // unvalidated one to the poll loop. See liveQuizApi.ts's assertGameCode
  // docstring for why (client-side path traversal / CSPT).
  const routeCodeValid = isValidLiveQuizCode(routeCode);
  const { state, error: pollError } = useLiveQuizPoll(token ?? null, routeCodeValid ? routeCode : null);

  const runControl = useCallback(
    async (fn: (token: string, code: string, body?: { device_id?: string; confirm_takeover?: boolean }) => Promise<unknown>) => {
      if (!token || !routeCode || !routeCodeValid) return;
      setBusy(true);
      setActionError('');
      try {
        await fn(token, routeCode, { device_id: getHostDeviceId() });
      } catch (err) {
        if (err instanceof LiveQuizApiError && err.status === 409 && err.message.includes('Another device')) {
          // UI/UX review #4: explicit confirm before taking over control
          // from another device/tab, never silent.
          setTakeoverPrompt(() => () => {
            setTakeoverPrompt(null);
            void fn(token, routeCode, { device_id: getHostDeviceId(), confirm_takeover: true });
          });
        } else {
          setActionError(err instanceof LiveQuizApiError ? err.message : '操作失敗，請稍後再試');
        }
      } finally {
        setBusy(false);
      }
    },
    [token, routeCode, routeCodeValid],
  );

  if (!routeCode) {
    return (
      <TeacherLiveQuizSetup
        onCreated={(code) => navigate(`/teacher/live/${code}`)}
      />
    );
  }

  if (!routeCodeValid) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">找不到這場搶答</p>
      </div>
    );
  }

  if (pollError && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{pollError}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="載入中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  const actionBar = (actionError || takeoverPrompt) && (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-on-surface/90 px-4 py-2 text-sm text-white">
      {takeoverPrompt ? (
        <>
          <span>另一個裝置正在控制這場搶答，是否要在這裡接手？</span>
          <button type="button" onClick={takeoverPrompt} className="rounded bg-accent px-3 py-1 font-medium">
            接手控制
          </button>
          <button type="button" onClick={() => setTakeoverPrompt(null)} className="underline">
            取消
          </button>
        </>
      ) : (
        <span>{actionError}</span>
      )}
    </div>
  );

  const endEarlyButton = ['lobby', 'question', 'reveal'].includes(state.status) && (
    <button
      type="button"
      onClick={() => {
        // PRD §12: "老師提早結束要確認並儲存" — a native confirm is blunt
        // but unambiguous, and this is an internal host-only control.
        if (window.confirm('確定要提前結束這場課堂搶答嗎？已產生的分數會保留。')) {
          void runControl(endLiveQuizGame);
        }
      }}
      className="fixed right-4 top-4 z-40 rounded-full border border-surface-dim bg-white/90 px-4 py-1.5 text-xs font-medium text-on-surface-variant shadow hover:bg-white"
    >
      提前結束
    </button>
  );

  switch (state.status) {
    case 'lobby':
      return (
        <>
          {actionBar}
          {endEarlyButton}
          <TeacherLiveQuizLobby
            state={state}
            token={token ?? ''}
            code={routeCode}
            onStart={() => void runControl(startLiveQuizGame)}
            starting={busy}
          />
        </>
      );
    case 'question':
      return (
        <>
          {actionBar}
          {endEarlyButton}
          <TeacherLiveQuizQuestion state={state} onReveal={() => void runControl(revealLiveQuizRound)} revealing={busy} />
        </>
      );
    case 'reveal':
      return (
        <>
          {actionBar}
          {endEarlyButton}
          <TeacherLiveQuizReveal state={state} onNext={() => void runControl(nextLiveQuizRound)} advancing={busy} />
        </>
      );
    case 'ended':
      return <TeacherLiveQuizPodium state={state} token={token ?? ''} code={routeCode} />;
    default:
      return null;
  }
};

export default TeacherLiveQuizHost;
