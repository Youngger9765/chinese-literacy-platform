/**
 * LiveQuizInviteBanner — "開給本班" invite on student home.
 *
 * PRD §9 item 8 / #3551 external review: polled every 10-15s ONLY while
 * this component is mounted (i.e. the home page is open) — NOT every
 * second like the in-game /state poll. One indexed query per poll.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { getLiveQuizInvite, type LiveQuizInvite } from '../../../services/liveQuizApi';

const POLL_MS = 12_000;

const LiveQuizInviteBanner: React.FC = () => {
  const { token } = useAuth();
  const [invite, setInvite] = useState<LiveQuizInvite | null>(null);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const poll = () => {
      getLiveQuizInvite(token)
        .then((res) => {
          if (!cancelled) setInvite(res.invite);
        })
        .catch(() => {
          /* best-effort — a missed poll just tries again next interval */
        });
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  if (!invite) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-accent-bg px-4 py-3 text-sm">
      <span className="font-medium text-accent">老師開了一場課堂搶答，要加入嗎？</span>
      <Link
        to={`/live/${invite.code}`}
        className="shrink-0 rounded-lg bg-accent px-4 py-1.5 font-semibold text-white"
      >
        加入
      </Link>
    </div>
  );
};

export default LiveQuizInviteBanner;
