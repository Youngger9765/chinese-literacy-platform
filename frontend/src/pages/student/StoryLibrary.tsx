
import React, { useState, useEffect } from 'react';
import { Story } from '../../types';
import { fetchStories, fetchStory } from '../../services/api';
import { getClassroomTexts } from '../../services/teacherApi';
import { getGamificationPoints } from '../../services/gamificationApi';
import { useAuth } from '../../contexts/AuthContext';
import StoryCard, { Difficulty, DIFFICULTY_CONFIG, getDifficulty } from '../../components/student/StoryCard';

interface StoryLibraryProps {
  onStartReading: (story: Story) => void;
  limit?: number;
  /** Slugs of already-completed stories — shows completion badge on card. */
  completedSlugs?: string[];
  /** When set, show only texts assigned to this classroom (from 我的班級→課文庫). */
  classroomId?: number | null;
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
}) => {
  const { token, user } = useAuth();
  const [xpToNext, setXpToNext] = useState<number | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingStoryId, setLoadingStoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [availableGrades, setAvailableGrades] = useState<number[]>([]);
  const [classroomFilterLabel, setClassroomFilterLabel] = useState<string | null>(null);

  const completedSet = new Set(completedSlugs);

  // Fetch XP info for callout badges (lightweight, non-blocking)
  useEffect(() => {
    if (!token || !user) return;
    getGamificationPoints(user.id, token)
      .then((data) => setXpToNext(data.level_info.xp_to_next))
      .catch(() => {/* silently ignore — XP callout is cosmetic */});
  }, [token, user]);

  useEffect(() => {
    if (!token) return;
    if (classroomId != null && !isNaN(classroomId)) {
      getClassroomTexts(token, classroomId)
        .then((items) => {
          const stories: Story[] = items.map((ct) => ({
            id: ct.text_id,
            title: ct.title,
            level: 0,
            content: [],
            thumbnail: '',
            category: 'reading',
            filename: '',
            intro: { author: '', background: '' },
            grade: 0,
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

  // Chain of filters
  let filtered = allStories;
  if (selectedGrade != null) filtered = filtered.filter((s) => s.grade === selectedGrade);
  if (selectedDifficulty != null) filtered = filtered.filter((s) => getDifficulty(s) === selectedDifficulty);
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
      onStartReading(fullStory);
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
            level: 0,
            content: [],
            thumbnail: '',
            category: 'reading',
            filename: '',
            intro: { author: '', background: '' },
            grade: 0,
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
    setSelectedDifficulty(null);
    setShowOnlyUnread(false);
  };

  const hasActiveFilter = searchQuery || selectedGrade != null || selectedDifficulty != null || showOnlyUnread;

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
          全部年級
        </button>
        {availableGrades.map((grade) => (
          <button
            key={grade}
            onClick={() => setSelectedGrade(grade)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedGrade === grade ? 'bg-accent text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
            }`}
          >
            {grade}年級
          </button>
        ))}

        <span className="text-gray-300 text-sm">|</span>

        {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
          const cfg = DIFFICULTY_CONFIG[d];
          return (
            <button
              key={d}
              onClick={() => setSelectedDifficulty(selectedDifficulty === d ? null : d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                selectedDifficulty === d ? `${cfg.className} border-current` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {cfg.label}
            </button>
          );
        })}
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
                estimatedXP={ESTIMATED_XP}
                closeToLevelUp={isCloseToLevelUp}
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
