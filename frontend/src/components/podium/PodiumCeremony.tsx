/**
 * PodiumCeremony — #3630 課堂搶答結束畫面：高質感頒獎台。
 *
 * Spec corrected 2026-10-18 (Young, via issue comment): the podium DOES
 * show each top-3 finisher's score on their plinth, alongside their name
 * (originally scoped as score-free; superseded). Students never see rank —
 * that rule lives entirely on the student screens and is unaffected by
 * this file (this component only ever renders on the teacher/projector
 * podium page, TeacherLiveQuizPodium.tsx).
 *
 * There is no "classroom story pack" theme concept wired into live-quiz
 * today (that exists for the unrelated PK battle feature —
 * frontend/src/components/pk/*, frontend/public/story-assets/). This
 * component intentionally ships only the polished default gold/amber
 * awards theme described in the issue; story-pack theming for live-quiz
 * is out of scope for #3630.
 */
import React, { useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { LiveQuizLeaderboardEntry } from '../../services/liveQuizApi';
import { usePrefersReducedMotion } from '../pk/usePrefersReducedMotion';
import { usePodiumCeremony } from './usePodiumCeremony';
import { playPodiumChime, usePodiumMute } from './podiumSound';

interface PodiumCeremonyProps {
  topThree: LiveQuizLeaderboardEntry[];
}

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

const CONFETTI_COLOR_CLASSES = ['bg-accent', 'bg-tertiary-container', 'bg-success', 'bg-warning'];
const CONFETTI_ANIM_CLASSES = ['animate-confetti-drop-1', 'animate-confetti-drop-2', 'animate-confetti-drop-3'];
const CONFETTI_PIECE_COUNT = 28;

// Plinth layout per rank: visual order (center/left/right), relative
// height, and sizing so 1st place reads as the biggest moment.
const PLINTH_LAYOUT: Record<
  number,
  { order: string; heightClass: string; widthClass: string; big: boolean }
> = {
  1: { order: 'order-2', heightClass: 'h-28 sm:h-36 md:h-48', widthClass: 'w-24 sm:w-32 md:w-40', big: true },
  2: { order: 'order-1', heightClass: 'h-20 sm:h-28 md:h-36', widthClass: 'w-20 sm:w-28 md:w-36', big: false },
  3: { order: 'order-3', heightClass: 'h-14 sm:h-20 md:h-28', widthClass: 'w-20 sm:w-28 md:w-36', big: false },
};

function ConfettiBurst() {
  const pieces = Array.from({ length: CONFETTI_PIECE_COUNT }, (_, i) => {
    const left = (i * 37) % 100; // deterministic-but-scattered spread
    const rotate = (i * 53) % 360;
    const delay = (i % 6) * 0.08;
    const colorClass = CONFETTI_COLOR_CLASSES[i % CONFETTI_COLOR_CLASSES.length];
    const animClass = CONFETTI_ANIM_CLASSES[i % CONFETTI_ANIM_CLASSES.length];
    return (
      <div
        key={i}
        className={`absolute top-0 h-2.5 w-2.5 rounded-sm ${colorClass} ${animClass}`}
        style={{ left: `${left}%`, transform: `rotate(${rotate}deg)`, animationDelay: `${delay}s` }}
      />
    );
  });

  return (
    <div data-testid="podium-confetti" className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces}
    </div>
  );
}

interface PlinthProps {
  rank: number;
  entry: LiveQuizLeaderboardEntry;
  revealed: boolean;
}

function Plinth({ rank, entry, revealed }: PlinthProps) {
  const layout = PLINTH_LAYOUT[rank];
  return (
    // The whole plinth — name/score card + the block itself — lives inside
    // ONE data-testid element, so `within(getByTestId(...))` can find the
    // name/score once revealed without reaching outside this rank's own
    // subtree into a sibling's.
    <div
      data-testid={`podium-plinth-${rank}`}
      data-revealed={revealed ? 'true' : 'false'}
      className={`flex flex-col items-center ${layout.order}`}
    >
      {/* Name + score card — rises above the block, fades/pops in a beat
          after the block itself starts rising. */}
      <div
        className={`mb-2 flex min-h-[3.25rem] max-w-[6.5rem] sm:max-w-[8.5rem] flex-col items-center justify-end text-center transition-opacity duration-200 ${
          revealed ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {revealed && (
          <>
            <span className={layout.big ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'} aria-hidden="true">
              {MEDALS[rank]}
            </span>
            <span
              className={`mt-1 truncate font-semibold text-on-surface animate-pop ${
                layout.big ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
              }`}
            >
              {entry.display_name}
            </span>
            <span
              className="mt-0.5 animate-pop text-sm font-bold text-accent sm:text-base"
              style={{ animationDelay: '0.08s' }}
            >
              {entry.total_score}
            </span>
          </>
        )}
      </div>

      {/* The podium block itself. */}
      <div
        className={`relative flex items-start justify-center rounded-t-lg border-t-4 ${layout.widthClass} ${
          layout.heightClass
        } ${
          layout.big ? 'border-warning bg-gradient-to-b from-accent-bg to-accent-bg-subtle' : 'border-accent-light bg-surface-container'
        } transition-all ease-[cubic-bezier(0.34,1.56,0.64,1)] duration-500 ${
          revealed ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-40'
        }`}
      >
        {layout.big && revealed && (
          <div
            className="pointer-events-none absolute -top-10 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full opacity-70"
            style={{ background: 'radial-gradient(circle, rgb(var(--color-warning) / 0.35), transparent 70%)' }}
            aria-hidden="true"
          />
        )}
        <span className="mt-1 text-xs font-bold text-on-surface-variant sm:text-sm">{rank}</span>
      </div>
    </div>
  );
}

function LightRays() {
  // A handful of tasteful translucent wedges radiating from behind 1st
  // place — built from the existing warning color token, not a new hex.
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 -translate-y-10 opacity-40"
      style={{
        background:
          'conic-gradient(from 0deg, transparent 0deg, rgb(var(--color-warning) / 0.25) 8deg, transparent 16deg, transparent 80deg, rgb(var(--color-warning) / 0.25) 88deg, transparent 96deg, transparent 170deg, rgb(var(--color-warning) / 0.25) 178deg, transparent 186deg, transparent 260deg, rgb(var(--color-warning) / 0.25) 268deg, transparent 276deg, transparent 360deg)',
      }}
      aria-hidden="true"
    />
  );
}

const PodiumCeremony: React.FC<PodiumCeremonyProps> = ({ topThree }) => {
  const reducedMotion = usePrefersReducedMotion();
  const availableRanks = topThree.map((_, i) => i + 1);
  const { revealedRanks, showConfetti, replay } = usePodiumCeremony(availableRanks, reducedMotion);
  const [muted, toggleMuted] = usePodiumMute(reducedMotion);

  const previouslyRevealedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (reducedMotion) {
      // Everything is revealed synchronously on mount in this mode — there
      // is no reveal transition to react to, so never make a sound.
      previouslyRevealedRef.current = new Set(revealedRanks);
      return;
    }
    const previously = previouslyRevealedRef.current;
    const newlyRevealed = [...revealedRanks].filter((rank) => !previously.has(rank));
    if (!muted) {
      if (newlyRevealed.includes(1)) {
        playPodiumChime('fanfare');
      } else if (newlyRevealed.length > 0) {
        playPodiumChime('rise');
      }
    }
    previouslyRevealedRef.current = new Set(revealedRanks);
  }, [revealedRanks, muted, reducedMotion]);

  const orderedEntries = topThree.map((entry, i) => ({ rank: i + 1, entry }));

  return (
    <div className="relative mb-10 min-h-[14rem]">
      <button
        type="button"
        data-testid="podium-mute-toggle"
        aria-pressed={muted ? 'true' : 'false'}
        aria-label={muted ? '取消靜音' : '靜音'}
        onClick={toggleMuted}
        className="absolute right-0 top-0 rounded-full border border-surface-dim bg-white p-2 text-on-surface-variant hover:bg-surface-container-low"
      >
        {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      </button>

      {orderedEntries.length === 0 ? (
        <p className="py-12 text-center text-on-surface-variant">沒有同學完成這場搶答</p>
      ) : (
        <div className="relative flex items-end justify-center gap-3 pt-16 sm:gap-6">
          {!reducedMotion && <LightRays />}
          {!reducedMotion && showConfetti && <ConfettiBurst />}
          {orderedEntries.map(({ rank, entry }) => (
            <Plinth key={entry.player_id} rank={rank} entry={entry} revealed={revealedRanks.has(rank)} />
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          data-testid="podium-replay-button"
          onClick={replay}
          className="rounded-xl border border-surface-dim px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-low"
        >
          再看一次
        </button>
      </div>
    </div>
  );
};

export default PodiumCeremony;
