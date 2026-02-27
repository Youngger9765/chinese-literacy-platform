
import React, { useState, useEffect } from 'react';
import { Story } from '../../types';
import { fetchStories, fetchStory } from '../../services/api';

interface StoryLibraryProps {
  onStartReading: (story: Story) => void;
  limit?: number;
}

const StoryLibrary: React.FC<StoryLibraryProps> = ({ onStartReading, limit }) => {
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingStoryId, setLoadingStoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [availableGrades, setAvailableGrades] = useState<number[]>([]);

  useEffect(() => {
    fetchStories()
      .then(({ stories, grades }) => {
        setAllStories(stories);
        setAvailableGrades(grades);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // Filter by grade
  const filteredByGrade = selectedGrade
    ? allStories.filter((s) => s.grade === selectedGrade)
    : allStories;

  // Filter by search query
  const filteredLessons = searchQuery
    ? filteredByGrade.filter(lesson =>
        lesson.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : filteredByGrade;

  // Apply limit if provided
  const stories = limit ? filteredLessons.slice(0, limit) : filteredLessons;

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

  // Skeleton card component
  const SkeletonCard = () => (
    <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <div className="h-40 bg-gray-200 animate-pulse" />
      <div className="p-4 space-y-2">
        <div className="h-5 bg-gray-200 animate-pulse rounded w-3/4" />
        <div className="h-3 bg-gray-200 animate-pulse rounded w-1/2" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header with lesson count */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">選擇讀本</h2>
        <p className="text-gray-600 text-sm">
          共 {allStories.length} 篇文章
          {selectedGrade && ` · 第 ${selectedGrade} 年級`}
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="text-center py-4 text-red-600 bg-red-50 rounded-lg">
          <p>載入失敗：{error}</p>
          <button
            onClick={() => { setError(null); setIsLoading(true); fetchStories().then(({ stories, grades }) => { setAllStories(stories); setAvailableGrades(grades); }).catch((err) => setError(err.message)).finally(() => setIsLoading(false)); }}
            className="mt-2 text-sm underline"
          >
            重試
          </button>
        </div>
      )}

      {/* Grade filter tabs */}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={() => setSelectedGrade(null)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedGrade === null
              ? 'bg-accent text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
          }`}
        >
          全部
        </button>
        {availableGrades.map((grade) => (
          <button
            key={grade}
            onClick={() => setSelectedGrade(grade)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedGrade === grade
                ? 'bg-accent text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
            }`}
          >
            {grade}年級
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="max-w-md mx-auto">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋課文標題..."
            className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="text-sm text-gray-600 mt-2 text-center">
            找到 {stories.length} 篇
          </p>
        )}
      </div>

      {/* Story grid - Loading state */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <SkeletonCard key={idx} />
          ))}
        </div>
      ) : (
        /* Story grid - Loaded state */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {stories.map((story) => (
            <div
              key={story.id}
              className={`bg-white rounded-xl overflow-hidden border border-gray-200 hover:border-accent transition-all cursor-pointer group shadow-sm ${
                loadingStoryId === story.id ? 'opacity-60 pointer-events-none' : ''
              }`}
              onClick={() => handleStoryClick(story)}
            >
              <div className="h-40 overflow-hidden relative">
                <img
                  src={story.thumbnail}
                  alt={story.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                {/* Grade badge */}
                {story.grade && (
                  <div className="absolute top-2 right-2 bg-accent text-white text-xs font-bold px-2 py-1 rounded">
                    {story.grade}年級
                  </div>
                )}
                {/* Loading overlay */}
                {loadingStoryId === story.id && (
                  <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <h4 className="text-gray-900 font-bold mb-1">{story.title}</h4>
                {story.filename && (
                  <div className="text-[10px] text-gray-500 font-mono">{story.filename}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && stories.length === 0 && !error && (
        <div className="text-center py-12 text-gray-600">
          <p>沒有找到符合條件的讀本</p>
        </div>
      )}
    </div>
  );
};

export default StoryLibrary;
