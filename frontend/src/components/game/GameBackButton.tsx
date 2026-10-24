/**
 * GameBackButton — shared "回到上一頁" affordance for the full-screen game
 * pages (#3747: "也要有回到上一頁的按鈕啊！！！！").
 *
 * These pages (`/pk`, `/live`, `/escape-room`, `/team-arena` and their
 * sub-routes) deliberately render with no `AppShell` — PRD language for
 * each one says "全程走全螢幕遊戲版面" — so there is no sidebar nav to fall
 * back on. That decision is fine for mid-game screens (see this
 * component's callers: it is only used on entry/selection screens, never
 * during an active round), but every one of those entry screens shipped
 * with zero way back except the browser's own back button, which a student
 * on a tablet/Chromebook may not have.
 *
 * Uses an explicit `to` route rather than `navigate(-1)` — the history
 * stack a student arrives with is not predictable (deep link from a lesson
 * conclusion page, QR code, sidebar, or mid-flow `replace: true` redirects
 * like StudentPkQueueWait's queue-matched navigation), so "go back one
 * step" can land somewhere other than this feature. An explicit
 * destination is always correct.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

interface GameBackButtonProps {
  /** Route to navigate to, e.g. `/game-hub` or `/pk`. */
  to: string;
  /** Visible label — defaults to the generic hub name. */
  label?: string;
  className?: string;
}

const GameBackButton: React.FC<GameBackButtonProps> = ({ to, label = '遊戲區', className = '' }) => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      aria-label={`返回${label}`}
      className={[
        'inline-flex items-center gap-1 self-start rounded-full px-3 py-1.5',
        'text-sm font-medium text-on-surface-variant',
        'hover:bg-surface-container active:scale-95 transition-transform',
        className,
      ].join(' ')}
    >
      <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
};

export default GameBackButton;
