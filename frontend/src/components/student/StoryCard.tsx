/**
 * StoryCard — individual story card with difficulty badge and completion indicator.
 * Issue #25
 */
import React from 'react';
import { Story } from '../../types';

export type Difficulty = 'easy' | 'medium' | 'hard';

export function getDifficulty(story: Story): Difficulty {
  const grade = story.grade;
  if (grade == null) return 'medium';
  if (grade <= 5) return 'easy';   // 4-5年級
  if (grade <= 7) return 'medium'; // 6-7年級
  return 'hard';                   // 8-9年級
}

export const DIFFICULTY_CONFIG: Record<Difficulty, { label: string; className: string }> = {
  easy:   { label: '入門', className: 'bg-green-100 text-green-700' },
  medium: { label: '中階', className: 'bg-yellow-100 text-yellow-700' },
  hard:   { label: '進階', className: 'bg-red-100 text-red-700' },
};

interface StoryCardProps {
  story: Story;
  isLoading: boolean;
  isCompleted: boolean;
  onClick: () => void;
}

const StoryCard: React.FC<StoryCardProps> = ({ story, isLoading, isCompleted, onClick }) => {
  const diff = getDifficulty(story);
  const diffConfig = DIFFICULTY_CONFIG[diff];

  return (
    <div
      className={`bg-white rounded-xl overflow-hidden border transition-all cursor-pointer group shadow-sm ${
        isCompleted ? 'border-green-300 hover:border-green-400' : 'border-gray-200 hover:border-accent'
      } ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}
      onClick={onClick}
    >
      <div className="h-40 overflow-hidden relative">
        <img
          src={story.thumbnail}
          alt={story.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {/* Top-right badges */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {story.grade && (
            <div className="bg-accent text-white text-xs font-bold px-2 py-0.5 rounded">
              {story.grade}年級
            </div>
          )}
          <div className={`text-xs font-medium px-2 py-0.5 rounded ${diffConfig.className}`}>
            {diffConfig.label}
          </div>
        </div>
        {/* Completed checkmark */}
        {isCompleted && (
          <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shadow">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <div className="p-4">
        <h4 className="text-gray-900 font-bold mb-1 line-clamp-1">{story.title}</h4>
        <div className="flex items-center gap-2 flex-wrap">
          {story.genre && (
            <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
              {story.genre}
            </span>
          )}
          {isCompleted && (
            <span className="text-xs text-green-600 font-medium">已完成</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoryCard;
