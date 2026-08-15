
import React, { useState, useEffect } from 'react';
import { Story } from '../../types';
import { fetchStories, fetchStory } from '../../services/api';
import { getClassroomTexts } from '../../services/teacherApi';
import { getGamificationPoints } from '../../services/gamificationApi';
import { getLibraryStatus, type LibraryStoryStatus } from '../../services/progressApi';
import { useAuth } from '../../contexts/AuthContext';
import StoryCard, { Difficulty, DIFFICULTY_CONFIG, getDifficulty } from '../../components/student/StoryCard';
import { gradeLabel } from '../../utils/gradeLabel';

interface StoryLibraryProps {
  onStartReading: (story: Story) => void | Promise<void>;
  limit?: number;
  /** Slugs of already-completed stories — shows completion badge on card. */
  completedSlugs?: string[];
  /** When set, show only texts assigned to this classroom (from 我的班級→課文庫). */
  classroomId?: number | null;
  /** When provided, shows a clear-progress button on completed story cards (Issue #2188). */
  onClearProgress?: (storyId: string) => void;
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

const SkeletonCard = () => (
  <div className="bg-white rounded-2xl overflow-hidden shadow-card">
    <div className="h-40 bg-gray-200 animate-pulse" />
    <div className="p-4 space-y-2">
      <div className="h-5 bg-gray-200 animate-pulse rounded w-3/4" />
      <div className="h-3 bg-gray-200 animate-pulse rounded w-1/2" />
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const StoryLibrary: React.FC<StoryLibraryProps> = ({
  onStartReading,
  limit,
  completedSlugs = [],
  classroomId = null,
  onClearProgress,
}) => {
  const { token, user } = useAuth();
  const [xpToNext, setXpToNext] = useState<number | null>(null);

  /* #1725: persist filter selections across the lesson round-trip so that
   * exiting a story returns to the same grade / difficulty / search the
   * student was browsing. Stored in sessionStorage so each tab keeps its own
   * view and a fresh tab starts clean. */
  const [selectedGrade, setSelectedGrade] = useState<string | null>(() => {
    try {
      const v = sessionStorage.getItem('library_filter_grade');
      if (!v || v === 'null') return null;
      // grade is a classification string now: "4".."9", 文言文, 品格教育.
      // Anything else in storage is junk from an older build and is dropped.
      return v;
    } catch { /* sessionStorage unavailable (e.g. private browsing) — degrade to default */ return null; }
  });
  // Clear the retired difficulty filter from anyone who still has one stored.
  // Without this, a student who landed on an impossible grade+difficulty pair before
  // the filter was removed keeps an empty library across reloads — the value sits in
  // sessionStorage and nothing reads it any more to clear it.
  useEffect(() => {
    try { sessionStorage.removeItem('library_filter_difficulty'); } catch { /* unavailable */ }
  }, []);

  const [searchQuery, setSearchQuery] = useState<string>(() => {
    try { return sessionStorage.getItem('library_filter_search') ?? ''; }
    catch { /* sessionStorage unavailable (e.g. private browsing) — degrade to default */ return ''; }
  });
  const [showOnlyUnread, setShowOnlyUnread] = useState<boolean>(() => {
    try { return sessionStorage.getItem('library_filter_unread') === '1'; }
    catch { /* sessionStorage unavailable (e.g. private browsing) — degrade to default */ return false; }
  });

  /* Persist whenever any filter changes. Empty catch is intentional: when
   * sessionStorage is unavailable (private browsing / quota exceeded) we
   * silently fall back to in-memory state for this mount. */
  useEffect(() => {
    try { sessionStorage.setItem('library_filter_grade', String(selectedGrade)); } catch { /* sessionStorage unavailable */ }
  }, [selectedGrade]);
  useEffect(() => {
    try { sessionStorage.setItem('library_filter_search', searchQuery); } catch { /* sessionStorage unavailable */ }
  }, [searchQuery]);
  useEffect(() => {
    try { sessionStorage.setItem('library_filter_unread', showOnlyUnread ? '1' : '0'); } catch { /* sessionStorage unavailable */ }
  }, [showOnlyUnread]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingStoryId, setLoadingStoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);
  const [classroomFilterLabel, setClassroomFilterLabel] = useState<string | null>(null);
  // Issue #1249: per-story student status map
  const [libraryStatus, setLibraryStatus] = useState<Record<string, LibraryStoryStatus>>({});

  // Bug fix #2188: completedSet merges external completedSlugs prop AND
  // stories with status='completed' from the API (libraryStatus).  This
  // means the clear-progress button is visible even when the caller does not
  // explicitly supply completedSlugs (the common case for LibraryPage).
  const completedSet = new Set([
    ...completedSlugs,
    ...Object.entries(libraryStatus)
      .filter(([, s]) => s === 'completed')
      .map(([id]) => id),
  ]);

  // Fetch XP info for callout badges (lightweight, non-blocking)
  useEffect(() => {
    if (!token || !user) return;
    getGamificationPoints(user.id, token)
      .then((data) => setXpToNext(data.level_info.xp_to_next))
      .catch(() => {/* silently ignore — XP callout is cosmetic */});
  }, [token, user]);

  // Issue #1249: fetch per-story status labels (non-blocking)
  useEffect(() => {
    if (!token) return;
    getLibraryStatus(token)
      .then((statusMap) => setLibraryStatus(statusMap))
      .catch(() => {/* silently ignore — status labels are cosmetic */});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (classroomId != null && !isNaN(classroomId)) {
      getClassroomTexts(token, classroomId)
        .then((items) => {
          const stories: Story[] = items.map((ct) => ({
            id: ct.text_id,
            title: ct.title,
            // `level` is a string in the Story contract; `0` was a pre-existing
            // type error here on main (2 sites), fixed in passing.
            level: '',
            content: [],
            thumbnail: '',
            // 'reading' was never one of the contract's four categories;
            // classroom texts have no category, so use the generic one.
            category: 'Daily',
            filename: '',
            intro: { author: '', background: '' },
            // Classroom texts carry no grade. The field is optional, so omit it
            // rather than inventing a value — `grade: 0` was a year that isn't (#2683).
            genre: '',
            charCount: 0,
          }));
          setAllStories(stories);
          setAvailableGrades([]);
          setClassroomFilterLabel('班級課文');
        })
        .catch((err) => setError(err.message ?? '無法載入班級課文'))
        .finally(() => setIsLoading(false));
    } else {
      fetchStories(token)
        .then(({ stories, grades }) => {
          setAllStories(stories);
          setAvailableGrades(grades);
          setClassroomFilterLabel(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => setIsLoading(false));
    }
  }, [token, classroomId]);

  // Chain of filters. In classroom mode the grade/difficulty controls are
  // hidden (#1725: also skipping their application so a persisted grade=7
  // doesn't wipe out a grade=0 classroom view).
  const inClassroomMode = classroomId != null && !isNaN(classroomId);
  let filtered = allStories;
  if (!inClassroomMode) {
    if (selectedGrade != null) filtered = filtered.filter((s) => s.grade === selectedGrade);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (s) => s.title.toLowerCase().includes(q) || (s.genre?.toLowerCase().includes(q) ?? false),
    );
  }
  if (showOnlyUnread) filtered = filtered.filter((s) => !completedSet.has(s.id));

  const stories = limit ? filtered.slice(0, limit) : filtered;
  const completedCount = allStories.filter((s) => completedSet.has(s.id)).length;

  const handleStoryClick = async (story: Story) => {
    setLoadingStoryId(story.id);
    try {
      const fullStory = await fetchStory(story.id);
      await onStartReading(fullStory);
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法載入課文');
    } finally {
      setLoadingStoryId(null);
    }
  };

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    if (classroomId != null && !isNaN(classroomId) && token) {
      getClassroomTexts(token, classroomId)
        .then((items) => {
          const stories: Story[] = items.map((ct) => ({
            id: ct.text_id,
            title: ct.title,
            // `level` is a string in the Story contract; `0` was a pre-existing
            // type error here on main (2 sites), fixed in passing.
            level: '',
            content: [],
            thumbnail: '',
            // 'reading' was never one of the contract's four categories;
            // classroom texts have no category, so use the generic one.
            category: 'Daily',
            filename: '',
            intro: { author: '', background: '' },
            // Classroom texts carry no grade. The field is optional, so omit it
            // rather than inventing a value — `grade: 0` was a year that isn't (#2683).
            genre: '',
            charCount: 0,
          }));
          setAllStories(stories);
        })
        .catch((err) => setError(err.message ?? '無法載入班級課文'))
        .finally(() => setIsLoading(false));
    } else {
      fetchStories(token ?? undefined)
        .then(({ stories, grades }) => { setAllStories(stories); setAvailableGrades(grades); })
        .catch((err) => setError(err.message))
        .finally(() => setIsLoading(false));
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedGrade(null);
    setShowOnlyUnread(false);
  };

  const hasActiveFilter = searchQuery || selectedGrade != null || showOnlyUnread;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {classroomFilterLabel ?? '選擇讀本'}
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            {classroomFilterLabel ? '此班級已指派的課文 · ' : ''}共 {allStories.length} 篇
            {completedCount > 0 && (
              <span className="ml-2 text-green-600">· 已讀 {completedCount} 篇</span>
            )}
          </p>
        </div>
        {completedCount > 0 && (
          <button
            onClick={() => setShowOnlyUnread(!showOnlyUnread)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              showOnlyUnread
                ? 'bg-accent text-white border-accent'
                : 'bg-white text-gray-600 border-gray-200 hover:border-accent'
            }`}
          >
            {showOnlyUnread ? '顯示全部' : '只看未讀'}
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="text-center py-4 text-red-600 bg-red-50 rounded-lg">
          <p>載入失敗：{error}</p>
          <button onClick={handleRetry} className="mt-2 text-sm underline">重試</button>
        </div>
      )}

      {/* Grade + Difficulty filter tabs — hidden when viewing classroom texts */}
      {!classroomFilterLabel && (
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setSelectedGrade(null)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            selectedGrade === null ? 'bg-accent text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
          }`}
        >
          全部級別
        </button>
        {availableGrades.map((grade) => (
          <button
            key={grade}
            onClick={() => setSelectedGrade(grade)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedGrade === grade ? 'bg-accent text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
            }`}
          >
            {gradeLabel(grade)}
          </button>
        ))}

        {/* 難度篩選已移除 (#2683)。

              它不是獨立屬性 —— getDifficulty 直接從年級推導（4-5 → 入門、6-7 → 中階、
              8-9 → 進階），所以兩排按鈕是同一個軸的兩種說法。並排放著等於邀請使用者
              組合，而 15 種組合裡有 10 種必定回 0 篇。

              更糟的是篩選狀態存在 sessionStorage：點到不可能的組合之後，重新整理仍是
              空的，看起來像「課文全部不見了」。年級已經表達了同一件事。*/}
      </div>
      )}

      {/* Search bar */}
      <div className="max-w-md">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋課文標題或體裁..."
            className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
          />
          {searchQuery ? (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </div>
        {hasActiveFilter && (
          <p className="text-xs text-gray-500 mt-1.5">找到 {stories.length} 篇</p>
        )}
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, idx) => <SkeletonCard key={idx} />)}
        </div>
      )}

      {/* Story grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {stories.map((story) => {
            const ESTIMATED_XP = 60;
            const isCloseToLevelUp = xpToNext != null && xpToNext > 0 && xpToNext <= ESTIMATED_XP;
            return (
              <StoryCard
                key={story.id}
                story={story}
                isLoading={loadingStoryId === story.id}
                isCompleted={completedSet.has(story.id)}
                onClick={() => handleStoryClick(story)}
                userStatus={libraryStatus[story.id]}
                estimatedXP={ESTIMATED_XP}
                closeToLevelUp={isCloseToLevelUp}
                onClearProgress={completedSet.has(story.id) && onClearProgress ? () => {
                  // Bug fix #2188: update libraryStatus state immediately so the
                  // card drops its "completed" appearance without needing a full
                  // page refresh (the DB record is reset by the caller).
                  setLibraryStatus((prev) => {
                    const next = { ...prev };
                    delete next[story.id];
                    return next;
                  });
                  onClearProgress(story.id);
                } : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && stories.length === 0 && !error && (
        <div className="text-center py-12 space-y-3">
          <div className="w-14 h-14 mx-auto rounded-xl bg-gray-100 flex items-center justify-center text-2xl">
            {showOnlyUnread ? '✅' : '🔍'}
          </div>
          <p className="text-gray-600 font-medium">
            {showOnlyUnread ? '所有課文都讀完了！' : '沒有找到符合條件的讀本'}
          </p>
          {showOnlyUnread ? (
            <p className="text-sm text-gray-400">可以選個舊課文複習，或切換「顯示全部」重新閱讀。</p>
          ) : (
            <button onClick={clearFilters} className="text-sm text-accent underline">清除篩選條件</button>
          )}
        </div>
      )}
    </div>
  );
};

export default StoryLibrary;
