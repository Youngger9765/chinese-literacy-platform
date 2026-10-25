/**
 * GameResultActions — shared "離開這個結算畫面" affordance (#3771,
 * game-academy audit r2 P0-2: "團體擂台／課堂搶答的結算畫面零個互動元素，
 * 只能按瀏覽器上一頁離開").
 *
 * PK's own result screen (`PkResultScreen.tsx`) already solved this with
 * three buttons (再戰一場／換對手／返回) — but that "換對手" concept is
 * specific to PK's 1-on-1 opponent-picker flow and doesn't translate to a
 * team match (再玩一場 for 多人對抗賽 just means "go start/join another
 * session", there's no equivalent of "pick a different AI tier") or to
 * 課堂搶答 (a student never starts their own round — the teacher does, so
 * there's no "再玩一場" action here at all). Rather than force-fit PK's
 * three-button layout onto two screens whose action set is genuinely
 * different, this is the minimal two-action shape both of them actually
 * need: an optional "再玩一場" (omit the prop when there's nothing to
 * replay) plus a 回遊戲區 that's always present.
 *
 * Deliberately NOT used to retrofit PkResultScreen.tsx — that screen's
 * three-button version is already shipped, tested, and working; extracting
 * every pixel of overlap into one shared component would mean touching
 * working code the bug report never asked about (see repo doctrine on not
 * expanding a surgical fix into a rewrite).
 */
import React from 'react';

interface GameResultActionsProps {
  /** Primary "play again" action. Omit entirely when this surface has no
   * sensible replay action (e.g. 課堂搶答 — the teacher starts rounds, not
   * the student) — the button simply won't render, not disabled/hidden. */
  onReplay?: () => void;
  replayLabel?: string;
  onBackToHub: () => void;
  backLabel?: string;
  className?: string;
}

const GameResultActions: React.FC<GameResultActionsProps> = ({
  onReplay,
  replayLabel = '再玩一場',
  onBackToHub,
  backLabel = '回遊戲區',
  className = '',
}) => (
  <div className={`mt-8 flex w-full max-w-md flex-col gap-3 pb-6 ${className}`} data-testid="game-result-actions">
    {onReplay && (
      <button
        type="button"
        onClick={onReplay}
        className="rounded-full bg-accent px-6 py-3 text-base font-bold text-white active:scale-95"
      >
        {replayLabel}
      </button>
    )}
    <button
      type="button"
      onClick={onBackToHub}
      className={
        onReplay
          ? 'rounded-full border border-accent px-6 py-3 text-base font-bold text-accent active:scale-95'
          : 'rounded-full bg-accent px-6 py-3 text-base font-bold text-white active:scale-95'
      }
    >
      {backLabel}
    </button>
  </div>
);

export default GameResultActions;
