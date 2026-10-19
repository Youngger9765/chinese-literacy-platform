/**
 * StudentTeamArenaJoin — `/team-arena` entry: text input for the 6-char
 * alphanumeric code (issue #3632, PRD §6 "學生端"), then navigate to
 * `/team-arena/:code` which does the actual join (same split as
 * StudentLiveQuizJoin.tsx / StudentLiveQuizPlay.tsx — this page never
 * calls the API itself).
 *
 * Alphanumeric (not live_quiz's numeric-only keypad) because team_arena
 * codes use the confusable-avoiding A-Z0-9 alphabet (engine.py
 * `_CODE_CHARS`), not digits.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

const StudentTeamArenaJoin: React.FC = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const complete = code.length === 6;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    navigate(`/team-arena/${code}`);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10">
      <h1 className="mb-1 text-xl font-bold text-on-surface">加入五人對抗賽</h1>
      <p className="mb-8 text-sm text-on-surface-variant">輸入老師投影的 6 碼代碼</p>

      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <input
          type="text"
          inputMode="text"
          value={code}
          onChange={(e) => setCode(sanitizeCode(e.target.value))}
          aria-label="6 碼五人對抗賽代碼"
          autoFocus
          className="mb-6 w-full rounded-xl border-2 border-surface-dim px-4 py-3 text-center text-2xl font-mono font-bold tracking-widest text-on-surface focus:border-accent focus:outline-none"
          placeholder="------"
        />
        <button
          type="submit"
          disabled={!complete}
          className="w-full rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-40"
        >
          加入
        </button>
      </form>
    </div>
  );
};

export default StudentTeamArenaJoin;
