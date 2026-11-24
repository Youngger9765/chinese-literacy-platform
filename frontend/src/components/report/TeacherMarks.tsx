/**
 * TeacherMarks — 老師的紅筆（#4104 學習批閱）
 *
 * 像小時候拿回考卷：右上角紅筆寫的分數、底下畫兩條線；評語用楷書、紅色，
 * 微微歪一點。數字用 Caveat（手寫數字），中文用 cwTeXKai（楷書）——
 * Google Fonts 的中文手寫體只有簡體字集，繁體字會掉回系統字，所以不用。
 */
import React from 'react';

const INK = '#d03a2f';

/** 紅筆分數。size：card = 關卡卡片右上角；total = 成績單總分；library = 圖書館選課卡片。 */
export const ScoreMark: React.FC<{
  score: number;
  size?: 'card' | 'total' | 'library';
  className?: string;
}> = ({ score, size = 'card', className = '' }) => {
  const text = size === 'total' ? 'text-6xl' : size === 'library' ? 'text-4xl' : 'text-3xl';
  return (
    <span
      className={`relative inline-flex flex-col items-center font-hand font-bold leading-none select-none ${text} ${className}`}
      style={{ color: INK, transform: 'rotate(-6deg)' }}
      aria-label={`老師給 ${score} 分`}
      data-testid={`score-mark-${size}`}
    >
      <span aria-hidden="true">{score}</span>
      {/* 兩條手畫的底線 */}
      <svg aria-hidden="true" viewBox="0 0 60 10" className="w-[110%] h-2 -mt-0.5" preserveAspectRatio="none">
        <path d="M2 3 Q 30 0 58 3" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M5 8 Q 32 5 56 7.5" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
};

/** 圖書館選課卡片：紅筆圈起來的總分，像考卷右上角。 */
export const CircledScore: React.FC<{ score: number }> = ({ score }) => (
  <span
    className="relative inline-flex items-center justify-center w-14 h-14 font-hand font-bold text-3xl leading-none select-none"
    style={{ color: INK, transform: 'rotate(-8deg)' }}
    aria-label={`老師給 ${score} 分`}
    data-testid="score-mark-library"
  >
    <svg aria-hidden="true" viewBox="0 0 56 56" className="absolute inset-0 w-full h-full">
      <path
        d="M28 4 C 44 3 53 15 52 29 C 51 44 40 53 26 52 C 12 51 3 41 4 27 C 5 14 15 6 30 6"
        stroke={INK}
        strokeWidth="2.5"
        fill="rgba(255,255,255,0.85)"
        strokeLinecap="round"
      />
    </svg>
    <span aria-hidden="true" className="relative">{score}</span>
  </span>
);

/** 老師評語（楷書、紅色）。 */
export const CommentNote: React.FC<{ comment: string; teacherName?: string | null; className?: string }> = ({
  comment,
  teacherName,
  className = '',
}) => (
  <p
    className={`font-sans text-base leading-snug whitespace-pre-wrap break-words ${className}`}
    style={{ color: INK }}
    data-testid="teacher-comment"
  >
    <span className="text-xs font-bold mr-1 align-middle opacity-80">{teacherName ? `${teacherName}：` : '老師：'}</span>
    {comment}
  </p>
);
