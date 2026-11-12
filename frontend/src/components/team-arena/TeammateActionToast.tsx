/**
 * TeammateActionToast — #3778 (game-academy audit r2, P2-1): "一位隊友答對
 * 、打倒一座塔，另一位隊友（非當前答題者）看到的畫面只有進度條安靜地變化
 * ...沒有任何提示「隊友剛剛做了什麼」". `detectSideEvents` already derives
 * tower/base events for every viewer from PUBLIC data (PRD §0 v2 rule N —
 * the attack/collapse animation on the SideBar already uses this), but
 * that animation plays on the side panel that took the damage — nothing
 * calls out "that was YOUR team's doing" in so many words. This is an
 * explicit, unambiguous, short-lived text toast layered on top of the
 * existing animation (additive, not a replacement for it), framed from
 * the viewer's own side so a bench teammate — not just the student who
 * just answered — sees their team's progress named out loud.
 *
 * A plain CSS pop/fade (`animate-pop`), already neutralized site-wide
 * under `prefers-reduced-motion: reduce` (frontend/src/index.css), same
 * idiom as the hero banners' breathing glow elsewhere in this app.
 */
import React from 'react';

export type TeammateActionTone = 'good' | 'bad';

interface TeammateActionToastProps {
  text: string;
  tone: TeammateActionTone;
}

const TeammateActionToast: React.FC<TeammateActionToastProps> = ({ text, tone }) => (
  <div
    role="status"
    data-testid="teammate-action-toast"
    className={`animate-pop fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-md ${
      tone === 'good' ? 'bg-success' : 'bg-tertiary'
    }`}
  >
    {text}
  </div>
);

export default TeammateActionToast;
