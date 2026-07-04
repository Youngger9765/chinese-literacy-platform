/**
 * TodayLessonCard — today's lesson hero area sub-components.
 *
 * Exports:
 * - BookJacketCover     (internal thumbnail)
 * - BookJacketHero      (full lesson hero with CTA)
 * - ClassroomFallbackHero (shown when no active assignment)
 * - NoClassroomWaitingScreen (shown when student not in any classroom)
 *
 * Extracted from StudentHome.tsx (Issue #1952)
 */

import React, { useEffect, useState } from 'react';
import type { StudentAssignmentResponse } from '../../../services/assignmentApi';
import type { StudentEnrolledClassroom } from '../../../services/learningApi';
import { ASSET_BASE } from '../../../config/assetBase';

// ---------------------------------------------------------------------------
// NoClassroomWaitingScreen — shown to students not yet added to any classroom
// Issue #457
// ---------------------------------------------------------------------------

interface NoClassroomWaitingScreenProps {
  firstName: string;
}

export const NoClassroomWaitingScreen: React.FC<NoClassroomWaitingScreenProps> = ({ firstName }) => (
  <div className="flex-1 flex items-center justify-center min-h-[60vh]">
    <div className="max-w-sm w-full mx-auto px-6 py-10 text-center space-y-6">
      <div
        className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mx-auto"
        aria-hidden="true"
      >
        <span className="text-4xl">🏫</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold font-headline text-on-surface">
          你好，{firstName}！
        </h1>
        <p className="text-base text-on-surface-variant mt-2">你的老師還沒有把你加入班級</p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left space-y-3">
        <p className="text-sm font-semibold text-amber-900">下一步怎麼做？</p>
        <ol className="space-y-2 text-sm text-amber-800 list-decimal list-inside">
          <li>請聯繫你的老師</li>
          <li>請老師把你加入班級</li>
          <li>加入後重新登入，即可開始學習</li>
        </ol>
      </div>
      <p className="text-xs text-on-surface-variant/60">加入班級後重新整理頁面即可繼續</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// BookJacketCover — 200x270 book cover with real lesson thumbnail.
// Renders amber gradient + title fallback if the image fails to load.
// ---------------------------------------------------------------------------

interface BookJacketCoverProps {
  storyId: string | null;
  title: string;
}

// Same-origin asset proxy (#2486) — lingoleap-assets is now a private GCS bucket.
const THUMBNAIL_BASE = `${ASSET_BASE}/stories/thumbnails`;

export const BookJacketCover: React.FC<BookJacketCoverProps> = ({ storyId, title }) => {
  const [imgOk, setImgOk] = useState(true);
  const imgSrc = storyId ? `${THUMBNAIL_BASE}/lesson-${storyId}.webp` : null;

  // Reset error state when the story changes, so a previous 404 doesn't
  // block a new valid thumbnail if the component is reused.
  useEffect(() => {
    setImgOk(true);
  }, [storyId]);

  return (
    <div
      className="
        relative w-[160px] sm:w-[200px] aspect-[200/270] shrink-0
        rounded-l-sm rounded-r-md overflow-hidden
        bg-gradient-to-br from-[#F7B76B] via-[#F59E42] to-[#E8841C]
        shadow-[4px_6px_16px_rgba(245,158,66,0.3),-2px_0_0_rgba(0,0,0,0.05)]
      "
      aria-hidden="true"
    >
      {/* Spine shadow line */}
      <div
        className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 to-transparent"
        aria-hidden="true"
      />

      {/* Real cover image (hidden on error) */}
      {imgSrc && imgOk && (
        <img
          src={imgSrc}
          alt=""
          onError={() => setImgOk(false)}
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
        />
      )}

      {/* Text fallback (shown only if image absent or failed) */}
      {(!imgSrc || !imgOk) && (
        <div className="absolute inset-0 p-4 sm:p-5 flex flex-col justify-between text-white">
          <div className="text-xl sm:text-2xl font-bold leading-tight tracking-tight line-clamp-4">
            {title}
          </div>
          <div className="text-[10px] sm:text-xs opacity-90 tracking-widest">今 日 課 文</div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// BookJacketHero — large "today's lesson" anchor card.
// ---------------------------------------------------------------------------

export interface BookJacketHeroProps {
  assignment: StudentAssignmentResponse;
  onContinue: () => void;
}

export const BookJacketHero: React.FC<BookJacketHeroProps> = ({ assignment, onContinue }) => {
  const isInProgress = assignment.status === 'in_progress';
  const ctaLabel = isInProgress ? '繼續閱讀' : '開始閱讀';

  return (
    <section
      aria-labelledby="today-lesson-title"
      className="
        bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl
        p-5 sm:p-7
        grid grid-cols-[160px_1fr] sm:grid-cols-[200px_1fr] gap-5 sm:gap-7
        items-center
        shadow-editorial
      "
    >
      <BookJacketCover storyId={assignment.story_id} title={assignment.story_title} />

      <div className="min-w-0">
        <div className="text-[11px] font-bold tracking-widest text-tertiary-fixed-dim uppercase mb-1.5">
          今 日 課 文
        </div>
        <h1
          id="today-lesson-title"
          className="text-xl sm:text-[26px] font-bold font-headline text-on-surface leading-tight mb-1.5 line-clamp-2"
        >
          {assignment.story_title}
        </h1>
        <p className="text-sm text-on-surface-variant mb-4">
          {assignment.classroom_name}
        </p>

        {isInProgress && assignment.current_step && (
          <div className="flex items-center gap-2 mb-4">
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded-full
                         bg-tertiary-fixed/20 text-tertiary-dim
                         text-xs font-bold"
            >
              上次讀到
            </span>
            <span className="text-xs text-on-surface-variant">可以接著讀下去</span>
          </div>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="
            inline-flex items-center gap-2
            px-5 sm:px-6 py-3
            bg-accent hover:bg-accent-hover
            text-white font-bold text-sm sm:text-base
            rounded-xl
            shadow-sm hover:shadow-md
            transition-all duration-150
            active:scale-[0.98]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
          "
          aria-label={`${ctaLabel}「${assignment.story_title}」`}
        >
          <span aria-hidden="true">▶</span>
          <span>{ctaLabel}</span>
        </button>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// ClassroomFallbackHero — shown when student has no active assignment.
// ---------------------------------------------------------------------------

export interface ClassroomFallbackHeroProps {
  classroom: StudentEnrolledClassroom;
  onClick: () => void;
}

export const ClassroomFallbackHero: React.FC<ClassroomFallbackHeroProps> = ({ classroom, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="
      w-full text-left
      bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl
      p-5 sm:p-6
      flex items-center gap-4
      shadow-editorial
      hover:shadow-md hover:border-accent/40 transition-all duration-150
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
    "
    aria-label={`前往${classroom.name}`}
  >
    <div
      className="
        w-16 h-20 shrink-0
        rounded-sm
        bg-gradient-to-br from-[#F7B76B] via-[#F59E42] to-[#E8841C]
        flex items-center justify-center
        shadow-md
      "
      aria-hidden="true"
    >
      <span className="text-2xl">📖</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[11px] font-bold tracking-widest text-tertiary-fixed-dim uppercase mb-1">
        繼 續 學 習
      </div>
      <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight truncate">
        {classroom.name}
      </h1>
      <p className="text-sm text-on-surface-variant mt-0.5">
        老師：{classroom.teacher_name}
      </p>
    </div>
    <div
      className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 text-accent font-bold"
      aria-hidden="true"
    >
      →
    </div>
  </button>
);
