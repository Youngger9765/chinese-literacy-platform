/**
 * PkCountdownRing — PRD §3.3: "用圓環倒數（時間以環狀進度條消耗表示）取代
 * 純數字倒數，最後 3 秒環的顏色從 accent 紫轉為 warning 琥珀色...不轉紅"
 * (red is reserved platform-wide for system errors, DESIGN.md).
 *
 * Server-authoritative, same pattern as live-quiz/CountdownBar.tsx: always
 * computed from server timestamps, never a client-started local timer.
 */
import React, { useEffect, useState } from 'react';

interface PkCountdownRingProps {
  /** ISO timestamp — when this round's answer window opened (server time). */
  roundStartedAt: string;
  seconds: number;
  /** ISO timestamp from the same /state response, for clock-skew correction. */
  serverNow: string;
  size?: number;
}

const WARNING_THRESHOLD_SECONDS = 3;

function useRemainingMs(roundStartedAt: string, seconds: number, serverNow: string): number {
  const [remaining, setRemaining] = useState(seconds * 1000);

  useEffect(() => {
    const startMs = new Date(roundStartedAt).getTime();
    const serverNowMs = new Date(serverNow).getTime();
    const localNowMs = Date.now();
    const skew = serverNowMs - localNowMs;
    const limitMs = seconds * 1000;

    const tick = () => {
      const elapsed = Date.now() + skew - startMs;
      setRemaining(Math.max(0, limitMs - elapsed));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [roundStartedAt, seconds, serverNow]);

  return remaining;
}

const PkCountdownRing: React.FC<PkCountdownRingProps> = ({ roundStartedAt, seconds, serverNow, size = 72 }) => {
  const remainingMs = useRemainingMs(roundStartedAt, seconds, serverNow);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const pct = seconds > 0 ? Math.max(0, Math.min(1, remainingMs / (seconds * 1000))) : 0;
  const isWarning = remainingSeconds <= WARNING_THRESHOLD_SECONDS;

  const strokeWidth = Math.max(4, Math.round(size * 0.09));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
      aria-label={`剩餘 ${remainingSeconds} 秒`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-container"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`transition-[stroke-dashoffset,stroke] duration-100 ease-linear ${
            isWarning ? 'stroke-warning' : 'stroke-accent'
          }`}
        />
      </svg>
      <span
        className={`absolute font-bold tabular-nums ${isWarning ? 'text-warning' : 'text-accent'}`}
        style={{ fontSize: size * 0.3 }}
      >
        {remainingSeconds}
      </span>
    </div>
  );
};

export default PkCountdownRing;
