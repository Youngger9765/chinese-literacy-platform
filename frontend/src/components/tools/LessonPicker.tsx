/**
 * LessonPicker — left column of the /tools 練習工具箱 page.
 *
 * Renders a radio-select list of lessons with grade tabs + search box.
 * Reuses fetchStories from api.ts (same data source as StoryLibrary).
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Story } from '../../types';
import { fetchStories } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface LessonPickerProps {
  selectedId: string | null;
  onChange: (story: Story | null) => void;
}

const GRADE_LABELS: Record<number, string> = {
  3: '三年級',
  4: '四年級',
  5: '五年級',
  6: '六年級',
  7: '七年級',
};

const LessonPicker: React.FC<LessonPickerProps> = ({ selectedId, onChange }) => {
  const { token } = useAuth();
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [grades, setGrades] = useState<number[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    fetchStories(token)
      .then(({ stories, grades: g }) => {
        setAllStories(stories);
        setGrades(g);
      })
      .catch((err) => setError(err.message ?? '無法載入課文'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const filtered = useMemo(() => {
    let list = allStories;
    if (selectedGrade != null) list = list.filter((s) => s.grade === selectedGrade);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }
    return list;
  }, [allStories, selectedGrade, searchQuery]);

  const handleSelect = (story: Story) => {
    onChange(selectedId === story.id ? null : story);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-3">
        <h2 className="text-lg font-bold text-gray-900">選擇課文</h2>
        <p className="text-sm text-gray-500 mt-0.5">選一篇課文開始練習</p>
      </div>

      {/* Grade tabs */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => setSelectedGrade(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            selectedGrade === null
              ? 'bg-accent text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
          }`}
        >
          全部
        </button>
        {grades.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setSelectedGrade(selectedGrade === g ? null : g)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selectedGrade === g
                ? 'bg-accent text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-accent'
            }`}
          >
            {GRADE_LABELS[g] ?? `${g}年級`}
          </button>
        ))}
      </div>

      {/* Search box */}
      <div className="relative mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜尋課文標題..."
          className="w-full px-3 py-2 pr-8 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="清除搜尋"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}
      </div>

      {/* Result count */}
      {(selectedGrade != null || searchQuery) && !isLoading && (
        <p className="text-xs text-gray-400 mb-2">找到 {filtered.length} 篇</p>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 animate-pulse rounded-lg" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-6 text-red-500 text-sm">
            <p>載入失敗：{error}</p>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">
            <p>沒有符合的課文</p>
          </div>
        )}

        {!isLoading &&
          filtered.map((story) => {
            const isSelected = selectedId === story.id;
            return (
              <button
                key={story.id}
                type="button"
                onClick={() => handleSelect(story)}
                aria-pressed={isSelected}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
                  ${isSelected
                    ? 'bg-accent-bg border border-accent text-accent'
                    : 'bg-white border border-gray-100 text-gray-700 hover:bg-gray-50 hover:border-gray-200'
                  }
                `}
              >
                {/* Radio indicator */}
                <span
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? 'border-accent' : 'border-gray-300'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-accent" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{story.title}</span>
                  {story.grade && (
                    <span className="text-xs text-gray-400">
                      {GRADE_LABELS[story.grade] ?? `${story.grade}年級`}
                      {story.genre ? ` · ${story.genre}` : ''}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
};

export default LessonPicker;
