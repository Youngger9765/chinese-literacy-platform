/**
 * Leaderboard — shows class ranking by XP.
 * Highlights the current student's row.
 */
import React from 'react';
import type { LeaderboardEntry } from '../../services/gamificationApi';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentStudentId?: number;
  classroomName?: string;
  /** Max entries to display before truncating */
  limit?: number;
}

const RANK_STYLES: Record<number, { bg: string; text: string; icon: string }> = {
  1: { bg: 'bg-amber-50 border-amber-300',   text: 'text-amber-700', icon: '🥇' },
  2: { bg: 'bg-gray-50 border-gray-300',     text: 'text-gray-600',  icon: '🥈' },
  3: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-600', icon: '🥉' },
};

function getRankStyle(rank: number) {
  return RANK_STYLES[rank] ?? { bg: 'bg-white border-gray-100', text: 'text-gray-500', icon: String(rank) };
}

interface EntryRowProps {
  entry: LeaderboardEntry;
  isMe: boolean;
}

const EntryRow: React.FC<EntryRowProps> = ({ entry, isMe }) => {
  const style = getRankStyle(entry.rank);
  const isTopThree = entry.rank <= 3;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${style.bg} ${
        isMe ? 'ring-2 ring-blue-400 ring-offset-1' : ''
      } transition-all`}
    >
      {/* Rank */}
      <div className={`w-8 text-center font-black text-lg ${style.text} shrink-0`}>
        {isTopThree ? style.icon : entry.rank}
      </div>

      {/* Avatar placeholder */}
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-200 to-purple-200 flex items-center justify-center shrink-0">
        <span className="text-sm font-bold text-white">
          {entry.name.charAt(0)}
        </span>
      </div>

      {/* Name + Level */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-gray-800 truncate ${isMe ? 'text-blue-700' : ''}`}>
            {entry.name}
            {isMe && <span className="ml-1 text-xs text-blue-500">(我)</span>}
          </span>
          <span className="shrink-0 text-xs text-gray-400 font-medium">Lv.{entry.level}</span>
        </div>
        <div className="text-xs text-gray-400">
          完成 {entry.stories_completed} 篇課文
        </div>
      </div>

      {/* XP */}
      <div className="shrink-0 text-right">
        <div className="font-black text-gray-800">{entry.total_xp}</div>
        <div className="text-xs text-gray-400">XP</div>
      </div>
    </div>
  );
};

const Leaderboard: React.FC<LeaderboardProps> = ({
  entries,
  currentStudentId,
  classroomName,
  limit,
}) => {
  const displayed = limit ? entries.slice(0, limit) : entries;

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <div className="text-4xl mb-2">📊</div>
        <p className="text-sm">排行榜還沒有資料，快去完成課文！</p>
      </div>
    );
  }

  return (
    <div>
      {classroomName && (
        <h3 className="text-base font-bold text-gray-600 mb-3">{classroomName} 排行榜</h3>
      )}
      <div className="flex flex-col gap-2">
        {displayed.map((entry) => (
          <EntryRow
            key={entry.student_id}
            entry={entry}
            isMe={entry.student_id === currentStudentId}
          />
        ))}
      </div>
    </div>
  );
};

export default Leaderboard;
