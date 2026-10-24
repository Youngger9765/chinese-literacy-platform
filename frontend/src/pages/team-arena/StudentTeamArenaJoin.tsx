/**
 * StudentTeamArenaJoin — `/team-arena` entry (issue #3632, PRD §0 v2 改版
 * A/B/C): any student can either OPEN a room (pick team size + turns,
 * becomes host) or JOIN one by its 6-char code — no teacher, no
 * classroom. Codes use the confusable-avoiding A-Z0-9 alphabet
 * (engine.py `_CODE_CHARS`).
 *
 * #3747: the choose screen had no way back to 遊戲區 (host/join sub-screens
 * already had "返回" back to choose) — added GameBackButton + a short
 * "怎麼玩" line.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  createTeamArenaSession,
  TeamArenaApiError,
  type TeamArenaSide,
} from '../../services/teamArenaApi';
import GameBackButton from '../../components/game/GameBackButton';

function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

const TEAM_SIZE_CHOICES = [2, 3, 4, 5] as const;
const TURNS_CHOICES = [1, 2, 3] as const;

const SideButtons: React.FC<{ value: TeamArenaSide; onChange: (v: TeamArenaSide) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    {(['a', 'b'] as const).map((side) => (
      <button
        key={side}
        type="button"
        onClick={() => onChange(side)}
        className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
          value === side ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'
        }`}
      >
        {side === 'a' ? '甲隊' : '乙隊'}
      </button>
    ))}
  </div>
);

const StudentTeamArenaJoin: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [mode, setMode] = useState<'choose' | 'host' | 'join'>('choose');

  const [teamSize, setTeamSize] = useState<(typeof TEAM_SIZE_CHOICES)[number]>(5);
  const [turnsPerPlayer, setTurnsPerPlayer] = useState<(typeof TURNS_CHOICES)[number]>(2);
  const [hostSide, setHostSide] = useState<TeamArenaSide>('a');
  const [hostError, setHostError] = useState('');
  const [creating, setCreating] = useState(false);

  const [code, setCode] = useState('');
  const [joinSide, setJoinSide] = useState<TeamArenaSide>('a');
  const codeComplete = code.length === 6;

  const handleHost = async () => {
    if (!token || creating) return;
    setHostError('');
    setCreating(true);
    try {
      const res = await createTeamArenaSession(token, {
        team_size: teamSize,
        turns_per_player: turnsPerPlayer,
        side: hostSide,
      });
      navigate(`/team-arena/${res.code}`);
    } catch (err) {
      setHostError(err instanceof TeamArenaApiError ? err.message : '發起比賽失敗，請稍後再試');
      setCreating(false);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeComplete) return;
    navigate(`/team-arena/${code}?side=${joinSide}`);
  };

  if (mode === 'choose') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10">
        <div className="mb-2 w-full max-w-xs">
          <GameBackButton to="/game-hub" />
        </div>
        <h1 className="mb-1 text-xl font-bold text-on-surface">多人對抗賽</h1>
        <p className="mb-1 text-sm text-on-surface-variant">2～5 人一隊，答題推塔，攻下對方主堡獲勝</p>
        <p className="mb-8 text-xs text-on-surface-variant">發起或輸入代碼加入比賽，答對題目才能推進攻塔</p>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <button
            type="button"
            onClick={() => setMode('host')}
            className="w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm"
          >
            發起比賽
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className="w-full rounded-xl border-2 border-surface-dim px-4 py-3 text-base font-semibold text-on-surface"
          >
            輸入代碼加入
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'host') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-on-surface">發起比賽</h1>
        <div className="w-full max-w-xs space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">每隊人數</p>
            <div className="grid grid-cols-4 gap-2">
              {TEAM_SIZE_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTeamSize(n)}
                  className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                    teamSize === n ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'
                  }`}
                >
                  {n} 人
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">每人上場次數</p>
            <div className="grid grid-cols-3 gap-2">
              {TURNS_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTurnsPerPlayer(n)}
                  className={`rounded-lg border px-2 py-2 text-sm font-semibold ${
                    turnsPerPlayer === n ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'
                  }`}
                >
                  {n} 次
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">你要加入哪一隊</p>
            <SideButtons value={hostSide} onChange={setHostSide} />
          </div>
          {hostError && <p className="text-sm text-red-600">{hostError}</p>}
          <button
            type="button"
            onClick={handleHost}
            disabled={creating}
            className="w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {creating ? '建立中…' : '發起比賽'}
          </button>
          <button type="button" onClick={() => setMode('choose')} className="w-full text-sm text-on-surface-variant">
            返回
          </button>
        </div>
      </div>
    );
  }

  // mode === 'join'
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10">
      <h1 className="mb-1 text-xl font-bold text-on-surface">輸入代碼加入</h1>
      <p className="mb-8 text-sm text-on-surface-variant">向發起比賽的同學要 6 碼代碼</p>

      <form onSubmit={handleJoinSubmit} className="w-full max-w-xs space-y-5">
        <input
          type="text"
          inputMode="text"
          value={code}
          onChange={(e) => setCode(sanitizeCode(e.target.value))}
          aria-label="6 碼多人對抗賽代碼"
          autoFocus
          className="w-full rounded-xl border-2 border-surface-dim px-4 py-3 text-center text-2xl font-mono font-bold tracking-widest text-on-surface focus:border-accent focus:outline-none"
          placeholder="------"
        />
        <div>
          <p className="mb-2 text-sm font-semibold text-on-surface">你要加入哪一隊</p>
          <SideButtons value={joinSide} onChange={setJoinSide} />
        </div>
        <button
          type="submit"
          disabled={!codeComplete}
          className="w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-40"
        >
          加入
        </button>
        <button type="button" onClick={() => setMode('choose')} className="w-full text-sm text-on-surface-variant">
          返回
        </button>
      </form>
    </div>
  );
};

export default StudentTeamArenaJoin;
