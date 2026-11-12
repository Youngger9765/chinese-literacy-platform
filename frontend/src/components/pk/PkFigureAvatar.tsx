/**
 * PkFigureAvatar — #3761 round 4 (Young reviewed round 3's screenshots):
 * "六個圓還是純文字佔位——pk-avatars 合併後要改用真頭像（橫幅與 0/7 進度
 * 條都用），合併前就讓它們用同一套圓形頭像元件，不要放純字". Before this,
 * `PkHeroBanner` had its own inline `FigureThumb` and `PkHistoryPanel`'s
 * defeat roster rendered a plain `<img src={opponent.icon_url}>` — two
 * separate code paths that would each need updating by hand once
 * pk-avatars' 6 remaining PNGs land. Both now use THIS one component.
 *
 * Builds the image path directly from `slug` (`story-assets/pk-{slug}/
 * portrait-idle.png`), same reasoning as PkHeroBanner's original comment:
 * does NOT go through `pkFigures.ts`'s `PK_PNG_ART_OVERRIDE` map (still
 * only points tier 7/李白 at real art) or the opponents API's `icon_url`
 * (which resolves through that same stale map) — reading the slug path
 * directly means every figure's avatar upgrades the moment its PNG is
 * committed, in both places, with zero code change here.
 *
 * round-4 fix (Young: "六格只有名字、圖是一片空白——這是破圖"): it
 * WASN'T a broken image — `fireEvent.error` + mutation testing both
 * confirmed the fallback `<div>` renders correctly. The real bug was
 * contrast: the fallback used `bg-white/20` + `text-white`, which reads
 * fine inside PkHeroBanner's dark purple gradient but is nearly invisible
 * on PkHistoryPanel's near-white card background — a 20%-opacity white
 * circle with white text on a white panel is, for all practical purposes,
 * blank. Fixed by giving the fallback a SOLID, deterministic background
 * color (cycling the same kind of palette the live-quiz lobby's anonymous
 * peers use) instead of a translucent one — visible against any
 * background it's dropped into, not just the one it was first built in.
 */
import React, { useState } from 'react';

const SIZE_CLASSES = {
  sm: 'h-12 w-12 text-sm',
  // round 4 (Young: "手機版橫幅只顯示四位...要能看到全部七位"): shrunk the
  // mobile base size so all 7 fit a 390px viewport without needing to
  // scroll (7 × 40px + 6 × 8px gap = 328px, under the ~350px usable width
  // after page padding) — desktop (sm:) keeps the original larger size.
  md: 'h-10 w-10 text-sm sm:h-20 sm:w-20 sm:text-xl',
  lg: 'h-20 w-20 text-xl sm:h-24 sm:w-24 sm:text-2xl',
} as const;

export type PkFigureAvatarSize = keyof typeof SIZE_CLASSES;

interface PkFigureAvatarProps {
  slug: string;
  name: string;
  size?: PkFigureAvatarSize;
  /** Dims the avatar — "not unlocked yet" (defeat roster) or generically
   * "disabled" (not used by the banner, which never locks). */
  locked?: boolean;
  className?: string;
}

/** Solid, saturated palette for the no-photo-yet fallback — deliberately
 * NOT translucent (see round-4 fix note above): has to read clearly on
 * both PkHeroBanner's dark gradient and PkHistoryPanel's light panel. */
const FALLBACK_COLORS = ['#8B5CF6', '#F59E0B', '#10B981', '#3B82F6', '#EC4899', '#14B8A6', '#F97316'];

function colorForSlug(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

const PkFigureAvatar: React.FC<PkFigureAvatarProps> = ({ slug, name, size = 'md', locked = false, className = '' }) => {
  const [broken, setBroken] = useState(false);
  const dims = SIZE_CLASSES[size];

  if (broken) {
    // Locked + no photo yet: a plain muted gray (not this figure's color)
    // — "locked" should look visually different from "has art but hasn't
    // been beaten", and recoloring every unknown figure gray also avoids
    // implying a false distinction between 6 placeholder colors that mean
    // nothing yet.
    const bg = locked ? '#9CA3AF' : colorForSlug(slug);
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full border-2 border-white/40 font-bold text-white ${dims} ${className}`}
        style={{ backgroundColor: bg }}
        aria-hidden="true"
      >
        {name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={`/story-assets/pk-${slug}/portrait-idle.png`}
      alt={locked ? `${name}（尚未擊敗）` : name}
      onError={() => setBroken(true)}
      className={`shrink-0 rounded-full border-2 border-white/70 bg-white/20 object-cover object-top ${dims} ${
        locked ? 'grayscale opacity-60' : ''
      } ${className}`}
    />
  );
};

export default PkFigureAvatar;
