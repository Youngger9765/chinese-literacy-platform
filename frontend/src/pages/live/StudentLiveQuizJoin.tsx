/**
 * StudentLiveQuizJoin — `/live` entry: numeric keypad for the 6-digit
 * 課堂搶答 code, then a confirm step, then navigate to `/live/:code`.
 *
 * PRD §12: "輸入框叫數字鍵盤；在加入班級頁打了純數字要提示去「課堂搶答」"
 * — this page's own input is already numeric-only (`inputMode="numeric"`);
 * the reverse direction (classroom join page nudging here) lives in
 * JoinClassroomPage.tsx's own sanitizeCode, out of scope for this file.
 *
 * #3747: this screen had no way back to 遊戲區 except the browser's own
 * back button (no AppShell on this route) — added GameBackButton.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import GameBackButton from '../../components/game/GameBackButton';

function sanitizeDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

const StudentLiveQuizJoin: React.FC = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);

  const complete = code.length === 6;

  const handleDigit = (d: string) => {
    if (code.length < 6) setCode((c) => c + d);
  };
  const handleBackspace = () => setCode((c) => c.slice(0, -1));

  const handleConfirm = () => {
    if (!complete) return;
    navigate(`/live/${code}`);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10">
      <div className="mb-2 w-full max-w-xs">
        <GameBackButton to="/game-hub" />
      </div>
      <h1 className="mb-1 text-xl font-bold text-on-surface">加入課堂搶答</h1>
      <p className="mb-1 text-sm text-on-surface-variant">現在全班一起玩，約 10 分鐘</p>
      <p className="mb-8 text-sm text-on-surface-variant">輸入老師投影的 6 位數代碼</p>

      <div className="mb-8 flex gap-2" aria-live="polite">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`flex h-14 w-11 items-center justify-center rounded-lg border-2 text-2xl font-bold tabular-nums ${
              i < code.length ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'
            }`}
          >
            {code[i] ?? ''}
          </div>
        ))}
      </div>

      <input
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={code}
        onChange={(e) => setCode(sanitizeDigits(e.target.value))}
        aria-label="6 位數課堂搶答代碼"
        className="sr-only"
        autoFocus
      />

      {/* On-screen numeric keypad so this is usable even without a focused
          native input (projector-adjacent tablets, kiosk-style devices). */}
      <div className="mb-8 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => handleDigit(d)}
            className="h-16 w-16 rounded-xl bg-surface-container text-2xl font-semibold text-on-surface active:bg-surface-container-high"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={handleBackspace}
          aria-label="刪除"
          className="h-16 w-16 rounded-xl bg-surface-container text-xl text-on-surface-variant active:bg-surface-container-high"
        >
          ⌫
        </button>
        <button
          type="button"
          onClick={() => handleDigit('0')}
          className="h-16 w-16 rounded-xl bg-surface-container text-2xl font-semibold text-on-surface active:bg-surface-container-high"
        >
          0
        </button>
        <span />
      </div>

      {!confirming ? (
        <button
          type="button"
          disabled={!complete}
          onClick={() => setConfirming(true)}
          className="w-full max-w-xs rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-40"
        >
          下一步
        </button>
      ) : (
        <div className="w-full max-w-xs rounded-xl border border-surface-dim bg-white p-4 text-center">
          <p className="mb-3 text-sm text-on-surface-variant">
            代碼 <span className="font-mono font-bold text-on-surface">{code}</span>，確定要加入嗎？
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-lg border border-surface-dim px-3 py-2 text-sm text-on-surface-variant"
            >
              重新輸入
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
            >
              確認加入
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentLiveQuizJoin;
