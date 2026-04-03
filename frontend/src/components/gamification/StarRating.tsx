import React, { useEffect, useState } from 'react';

export interface StarRatingProps {
  /** Number of stars earned: 1, 2, or 3 */
  stars: 1 | 2 | 3;
  /** Label shown below the stars */
  label: string;
  /** Optional sub-label (e.g. score breakdown) */
  subLabel?: string;
  /** Delay (ms) before animation starts */
  animationDelay?: number;
}

/**
 * Displays 1–3 animated stars with kid-friendly styling.
 * Stars appear one by one with a pop animation.
 */
const StarRating: React.FC<StarRatingProps> = ({
  stars,
  label,
  subLabel,
  animationDelay = 300,
}) => {
  const [visibleStars, setVisibleStars] = useState(0);
  const [labelVisible, setLabelVisible] = useState(false);

  useEffect(() => {
    // Reveal each star with a staggered delay
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= 3; i++) {
      timers.push(
        setTimeout(() => {
          setVisibleStars(v => Math.max(v, i));
        }, animationDelay + (i - 1) * 250),
      );
    }
    timers.push(
      setTimeout(() => setLabelVisible(true), animationDelay + 3 * 250 + 100),
    );
    return () => timers.forEach(clearTimeout);
  }, [animationDelay, stars]);

  const starColors: Record<number, { filled: string; glow: string }> = {
    1: { filled: '#f59e0b', glow: 'rgba(245,158,11,0.45)' },
    2: { filled: '#f59e0b', glow: 'rgba(245,158,11,0.45)' },
    3: { filled: '#fbbf24', glow: 'rgba(251,191,36,0.55)' },
  };

  const { filled, glow } = starColors[stars];

  return (
    <>
      <style>{`
        @keyframes star-appear {
          0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
          55%  { transform: scale(1.35) rotate(8deg);  opacity: 1; }
          75%  { transform: scale(0.9) rotate(-4deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg);    opacity: 1; }
        }
        @keyframes star-idle-pulse {
          0%, 100% { filter: drop-shadow(0 0 6px ${glow}); }
          50%       { filter: drop-shadow(0 0 14px ${glow}); }
        }
        @keyframes label-rise {
          0%   { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .star-appear {
          animation: star-appear 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards,
                     star-idle-pulse 2.5s ease-in-out 0.8s infinite;
        }
        .label-rise {
          animation: label-rise 0.4s ease forwards;
        }
      `}</style>

      <div className="flex flex-col items-center gap-3 select-none">
        {/* Stars row */}
        <div className="flex items-end gap-2">
          {[1, 2, 3].map(i => {
            const isFilled = i <= stars;
            const isVisible = i <= visibleStars;
            // Middle star (2nd) is slightly larger for visual drama
            const sizeClass = i === 2 ? 'text-[3.5rem]' : 'text-[2.75rem]';
            return (
              <span
                key={i}
                className={`${sizeClass} leading-none`}
                style={{
                  opacity: 0,
                  color: isFilled ? filled : '#d1d5db',
                  ...(isVisible
                    ? {
                        animationName: 'star-appear, star-idle-pulse',
                        animationDuration: `0.45s, 2.5s`,
                        animationTimingFunction:
                          'cubic-bezier(0.34,1.56,0.64,1), ease-in-out',
                        animationDelay: `0s, 0.8s`,
                        animationFillMode: 'forwards, none',
                        animationIterationCount: '1, infinite',
                        filter: isFilled
                          ? `drop-shadow(0 0 8px ${glow})`
                          : 'none',
                      }
                    : {}),
                }}
              >
                {isFilled ? '★' : '☆'}
              </span>
            );
          })}
        </div>

        {/* Label */}
        {labelVisible && (
          <div className="label-rise text-center">
            <p className="text-xl font-bold text-gray-800 tracking-wide">
              {label}
            </p>
            {subLabel && (
              <p className="text-sm text-gray-500 mt-0.5">{subLabel}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default StarRating;
