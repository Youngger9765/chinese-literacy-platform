/**
 * GuestReadingPage — 讀全文-做記號 for a visitor with no account (#2649).
 *
 * A student scans a QR code printed on a paper worksheet. The QR points at
 * /learn/{id}/full-text-annotate, they have never logged in, and if that URL
 * just showed them a password box the code would be pointless. So they get the
 * lesson text and the whole-lesson audio, and nothing that writes.
 *
 * Why this is a separate page rather than the normal shell with things hidden:
 * the authenticated shell opens a DB learning session on mount. Mounting it
 * without a user fires authenticated calls that 401 and leaves a half-built
 * session behind. This page talks to two endpoints, both verified public:
 *
 *   GET /api/stories/{id}   → 200 (8.6 KB) anonymous
 *
 * Annotating stays behind the login wall — a mark has to belong to somebody.
 * The invitation to log in is right there, so the path onward is one tap.
 *
 * The audio is deliberately NOT a separate source. An earlier version played a
 * pre-generated whole-lesson mp3 here, and the two paths drifted apart within
 * days: that file predated a pronunciation fix and, as it turned out, held the
 * key passage rather than the whole text. Owner, hearing the difference: 「全文
 * 朗讀的登錄的前後那個用的音怎麼不一樣啊」. Both paths now use the same
 * paragraph walk over the same canonical sentences, so there is nothing left to
 * drift.
 */
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

import ReadingAnnotation from '../components/reading-steps/FullTextAnnotate';
import { fetchStory } from '../services/api';
import type { Story } from '../types';

const GuestReadingPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const [story, setStory] = useState<Story | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    setFailed(false);
    fetchStory(storyId)
      .then((s) => {
        if (!cancelled) setStory(s);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  if (failed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface">
        <p className="text-lg text-on-surface-variant">找不到這一課</p>
        <Link to="/login" className="text-accent underline">
          回到登入
        </Link>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="text-on-surface-variant">載入中…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface" data-testid="guest-reading-page">
      {/* Top bar — the player lives here so it stays reachable while reading. */}
      <div className="sticky top-0 z-30 backdrop-blur bg-surface/85 border-b border-outline-variant/20">
        <div className="max-w-4xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-headline font-bold text-lg text-on-surface truncate">
              {story.title}
            </h1>
            <p className="text-xs text-on-surface-variant">課文朗讀</p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/login"
              className="text-sm font-medium text-accent whitespace-nowrap hover:underline"
            >
              登入做記號
            </Link>
          </div>
        </div>
      </div>

      <ReadingAnnotation story={story} onFinish={() => {}} hideAnnotation />
    </div>
  );
};

export default GuestReadingPage;
