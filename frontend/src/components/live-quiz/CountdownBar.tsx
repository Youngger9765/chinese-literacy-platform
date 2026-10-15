/**
 * CountdownBar — server-authoritative countdown.
 *
 * PRD §12: "學生手機倒數只用細進度條，不顯示數字" (player mode). Host
 * (投影) shows a big number instead ("倒數 72px／96px").
 *
 * Always computed from server timestamps (`answerOpenAt` + `seconds`), not
 * a client-started local timer — a refresh resumes correctly because the
 * server, not the browser, owns "when did this start".
 */
import React, { useEffect, useState } from 'react';

interface CountdownBarProps {
  /** ISO timestamp — when the answer window opened (server time). */
  answerOpenAt: string;
  /** Answer window length in seconds. */
  seconds: number;
  /** ISO timestamp from the same /state response, for clock-skew correction. */
  serverNow: string;
  mode: 'host' | 'player';
}

function useRemainingMs(answerOpenAt: string, seconds: number, serverNow: string): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const openAtMs = new Date(answerOpenAt).getTime();
    const serverNowMs = new Date(serverNow).getTime();
    const localNowMs = Date.now();
    // Offset between this browser's clock and the server's, sampled once
    // per /state response — avoids drifting if the device clock is wrong.
    const skew = serverNowMs - localNowMs;
    const limitMs = seconds * 1000;

    const tick = () => {
      const elapsed = Date.now() + skew - openAtMs;
      setRemaining(Math.max(0, limitMs - elapsed));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [answerOpenAt, seconds, serverNow]);

  return remaining;
}

const CountdownBar: React.FC<CountdownBarProps> = ({ answerOpenAt, seconds, serverNow, mode }) => {
  const remainingMs = useRemainingMs(answerOpenAt, seconds, serverNow);
  const pct = seconds > 0 ? Math.min(100, Math.max(0, (remainingMs / (seconds * 1000)) * 100)) : 0;
  // "時間到用中性灰色" — neutral gray once time is up, not red (red is
  // reserved for system errors).
  const timeUp = remainingMs <= 0;
  const barColor = timeUp ? 'bg-on-surface-variant' : 'bg-accent';

  if (mode === 'player') {
    return (
      <div
        className="h-2 w-full rounded-full bg-surface-container overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="作答倒數"
      >
        <div
          className={`h-full ${barColor} transition-[width] duration-100 ease-linear`}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  // PRD §12: 倒數 72px（1280 寬）／96px（1920 寬）.
  return (
    <div
      className={`font-bold tabular-nums ${timeUp ? 'text-on-surface-variant' : 'text-accent'}`}
      style={{ fontSize: 'clamp(72px, 24px + 3.75vw, 96px)' }}
      aria-live="polite"
    >
      {remainingSeconds}
    </div>
  );
};

export default CountdownBar;
