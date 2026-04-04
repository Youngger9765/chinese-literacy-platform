/**
 * AchievementCard — displays a single achievement badge.
 *
 * Shows the badge icon (emoji mapped from icon key), name, description,
 * and whether the student has unlocked it. Locked badges appear dimmed.
 */

import React from 'react';

export interface BadgeInfo {
  key: string;
  name: string;
  description: string;
  icon: string;   // icon key from BADGE_CATALOGUE (e.g. "fire", "book")
  color: string;  // color key (e.g. "orange", "blue", "gold")
  unlocked?: boolean;
  unlocked_at?: string;
}

interface AchievementCardProps {
  badge: BadgeInfo;
  size?: 'sm' | 'md' | 'lg';
}

// Map icon keys to emoji
const ICON_EMOJI: Record<string, string> = {
  star: '⭐',
  book: '📚',
  'book-open': '📖',
  library: '🏛️',
  fire: '🔥',
  trophy: '🏆',
  mic: '🎤',
  award: '🥇',
  brain: '🧠',
  crown: '👑',
  zap: '⚡',
  'calendar-check': '📅',
  compass: '🧭',
};

// Map color keys to Tailwind classes
const COLOR_MAP: Record<string, { bg: string; ring: string; text: string }> = {
  yellow: { bg: 'bg-yellow-50', ring: 'ring-yellow-300', text: 'text-yellow-700' },
  blue: { bg: 'bg-blue-50', ring: 'ring-blue-300', text: 'text-blue-700' },
  purple: { bg: 'bg-purple-50', ring: 'ring-purple-300', text: 'text-purple-700' },
  gold: { bg: 'bg-amber-50', ring: 'ring-amber-400', text: 'text-amber-700' },
  orange: { bg: 'bg-orange-50', ring: 'ring-orange-300', text: 'text-orange-700' },
  red: { bg: 'bg-red-50', ring: 'ring-red-300', text: 'text-red-700' },
  green: { bg: 'bg-green-50', ring: 'ring-green-300', text: 'text-green-700' },
  indigo: { bg: 'bg-indigo-50', ring: 'ring-indigo-300', text: 'text-indigo-700' },
  gray: { bg: 'bg-gray-50', ring: 'ring-gray-300', text: 'text-gray-600' },
  emerald: { bg: 'bg-emerald-50', ring: 'ring-emerald-300', text: 'text-emerald-700' },
  teal: { bg: 'bg-teal-50', ring: 'ring-teal-300', text: 'text-teal-700' },
};

function getColors(color: string, unlocked: boolean) {
  if (!unlocked) return { bg: 'bg-gray-50', ring: 'ring-gray-200', text: 'text-gray-400' };
  return COLOR_MAP[color] ?? COLOR_MAP.gray;
}

const AchievementCard: React.FC<AchievementCardProps> = ({ badge, size = 'md' }) => {
  const unlocked = badge.unlocked ?? true;
  const emoji = ICON_EMOJI[badge.icon] ?? '🏅';
  const colors = getColors(badge.color, unlocked);

  const sizeClasses = {
    sm: { card: 'p-3', icon: 'text-3xl', name: 'text-sm', desc: 'text-xs' },
    md: { card: 'p-4', icon: 'text-4xl', name: 'text-base', desc: 'text-xs' },
    lg: { card: 'p-5', icon: 'text-5xl', name: 'text-lg', desc: 'text-sm' },
  }[size];

  return (
    <div
      className={`
        rounded-2xl border-2 ${colors.bg}
        ${unlocked ? `ring-2 ${colors.ring}` : 'border-gray-200 opacity-50'}
        ${sizeClasses.card}
        flex flex-col items-center gap-2 text-center transition-all duration-200
        ${unlocked ? 'shadow-sm hover:shadow-md' : ''}
      `}
      title={badge.description}
    >
      <div className="relative">
        <div
          className={`
            ${sizeClasses.icon} leading-none
            ${unlocked ? '' : 'grayscale'}
          `}
          style={unlocked ? undefined : { filter: 'blur(4px)', opacity: 0.5 }}
        >
          {emoji}
        </div>
        {!unlocked && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg">🔒</span>
          </div>
        )}
      </div>

      <div>
        <div className={`font-black ${sizeClasses.name} ${unlocked ? colors.text : 'text-gray-400'}`}>
          {badge.name}
        </div>
        {unlocked ? (
          <div className={`${sizeClasses.desc} text-gray-500 mt-0.5 leading-snug`}>
            {badge.description}
          </div>
        ) : (
          <div className={`${sizeClasses.desc} text-gray-400 mt-0.5 leading-snug italic`}>
            {badge.description}
          </div>
        )}
      </div>

      {unlocked && badge.unlocked_at && (
        <div className="text-xs text-gray-400">
          {new Date(badge.unlocked_at).toLocaleDateString('zh-TW')}
        </div>
      )}
    </div>
  );
};

export default AchievementCard;
