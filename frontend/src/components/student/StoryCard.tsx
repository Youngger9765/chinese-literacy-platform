/**
 * StoryCard — individual story card with difficulty badge, completion indicator,
 * and per-student status label (Issue #1249).
 */
import React from 'react';
import { Story } from '../../types';
import type { LibraryStoryStatus } from '../../services/progressApi';
import { gradeLabel } from '../../utils/gradeLabel';

export type Difficulty = 'easy' | 'medium' | 'hard';

export function getDifficulty(story: Story): Difficulty {
  // Teacher-defined difficulty takes priority over grade-based auto-detect
  if (story.difficultyLevel === 'easy' || story.difficultyLevel === 'medium' || story.difficultyLevel === 'hard') {
    return story.difficultyLevel;
  }
  // grade is a classification string: "4".."9", 文言文, 品格教育.
  // The named collections are not a year, so no automatic difficulty applies —
  // for those a teacher override (difficultyLevel) is the only signal.
  const year = Number(story.grade);
  if (!Number.isFinite(year) || !story.grade) return 'medium';
  if (year <= 5) return 'easy';   // 4-5年級
  if (year <= 7) return 'medium'; // 6-7年級
  return 'hard';                  // 8-9年級
}

export const DIFFICULTY_CONFIG: Record<Difficulty, { label: string; className: string }> = {
  easy:   { label: '入門', className: 'bg-green-100 text-green-700' },
  medium: { label: '中階', className: 'bg-yellow-100 text-yellow-700' },
  hard:   { label: '進階', className: 'bg-red-100 text-red-700' },
};

// Status badge config for Issue #1249
const STATUS_BADGE: Record<LibraryStoryStatus, { label: string; className: string }> = {
  assigned:    { label: '作業中', className: 'bg-orange-100 text-orange-700 border border-orange-200' },
  in_progress: { label: '練習中', className: 'bg-blue-100 text-blue-700 border border-blue-200' },
  completed:   { label: '已完成', className: 'bg-green-100 text-green-700 border border-green-200' },
};

interface StoryCardProps {
  story: Story;
  isLoading: boolean;
  isCompleted: boolean;
  onClick: () => void;
  /** Per-student status label from /api/library/status (Issue #1249). Absent = not started. */
  userStatus?: LibraryStoryStatus;
  /** Estimated XP for completing this story (e.g. 60). Shown as a small badge. */
  estimatedXP?: number;
  /** When true, shows a "level up soon" hint instead of the XP estimate. */
  closeToLevelUp?: boolean;
  /** When provided, shows a small "clear progress" button on the card (Issue #2188). */
  onClearProgress?: () => void;
}

const StoryCard: React.FC<StoryCardProps> = ({ story, isLoading, isCompleted, onClick, userStatus, estimatedXP, closeToLevelUp, onClearProgress }) => {
  const diff = getDifficulty(story);
  const diffConfig = DIFFICULTY_CONFIG[diff];
  const statusBadge = userStatus ? STATUS_BADGE[userStatus] : null;

  // Card border reflects status: assigned = orange, completed = green, else default
  const borderClass = userStatus === 'assigned'
    ? 'border-orange-300 hover:border-orange-400'
    : isCompleted
      ? 'border-green-300 hover:border-green-400'
      : 'border-gray-200 hover:border-accent';

  return (
    <div
      className={`bg-white rounded-xl overflow-hidden border transition-all cursor-pointer group shadow-sm ${borderClass} ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}
      onClick={onClick}
    >
      <div className="h-40 overflow-hidden relative">
        {/* 二修的課目前沒有封面檔（`backend/data/lessons/` 底下 0 個圖），所以
            `thumbnail_url` 是 null。無條件 render <img> 會讓圖書館 175 張卡片
            全部變破圖 —— 破圖看起來像壞掉，而不是像「這課還沒有封面」。
            有圖就照常顯示；載入失敗也退回同一個佔位，兩種情況長得一樣。 */}
        {story.thumbnail ? (
          <img
            src={story.thumbnail}
            alt={story.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const ph = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (ph) ph.style.display = 'flex';
            }}
          />
        ) : null}
        <div
          data-testid="story-cover-placeholder"
          className="w-full h-full items-center justify-center bg-gray-100 text-gray-400"
          style={{ display: story.thumbnail ? 'none' : 'flex' }}
          aria-hidden="true"
        >
          <span className="material-symbols-outlined text-4xl">menu_book</span>
        </div>
        {/* Top-right badges */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {story.grade && (
            <div className="bg-accent text-white text-xs font-bold px-2 py-0.5 rounded">
              {gradeLabel(String(story.grade))}
            </div>
          )}
          <div className={`text-xs font-medium px-2 py-0.5 rounded ${diffConfig.className}`}>
            {diffConfig.label}
          </div>
        </div>
        {/* Status badge (top-left) — Issue #1249 */}
        {statusBadge && (
          <div className={`absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge.className}`}>
            {statusBadge.label}
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
          {isCompleted && !userStatus && (
            <span className="text-xs text-green-600 font-medium">已完成</span>
          )}
        </div>
        {story.customTags && story.customTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {story.customTags.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {/* XP callout */}
        {!isCompleted && (closeToLevelUp || (estimatedXP != null && estimatedXP > 0)) && (
          <div className="mt-2">
            {closeToLevelUp ? (
              <span className="text-xs font-semibold text-[#5B4FC4] bg-[#5B4FC4]/10 px-2 py-0.5 rounded-full">
                ⚡ 再 1 篇就升級！
              </span>
            ) : (
              <span className="text-xs text-gray-500">
                ⚡ 完成可得 ~{estimatedXP} XP
              </span>
            )}
          </div>
        )}
        {/* Clear progress button — only for completed stories (Issue #2188) */}
        {isCompleted && onClearProgress && (
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onClearProgress(); }}
            title="清除練習進度"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>restart_alt</span>
            清除進度
          </button>
        )}
      </div>
    </div>
  );
};

export default StoryCard;
