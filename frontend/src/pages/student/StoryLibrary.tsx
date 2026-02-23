
import React, { useState } from 'react';
import { Story } from '../../types';
import { getAllLessons, getLessonsByGrade, getAvailableGrades } from '../../data/lessonLoader';

interface StoryLibraryProps {
  onStartReading: (story: Story) => void;
  limit?: number;
}

const StoryLibrary: React.FC<StoryLibraryProps> = ({ onStartReading, limit }) => {
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const availableGrades = getAvailableGrades();
  const allLessons = getAllLessons();

  // Filter by grade
  const filteredLessons = selectedGrade
    ? getLessonsByGrade(selectedGrade)
    : allLessons;

  // Apply limit if provided
  const stories = limit ? filteredLessons.slice(0, limit) : filteredLessons;

  return (
    <div className="space-y-6">
      {/* Header with lesson count */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">選擇讀本</h2>
        <p className="text-slate-400 text-sm">
          共 {allLessons.length} 篇文章
          {selectedGrade && ` · 第 ${selectedGrade} 年級`}
        </p>
      </div>

      {/* Grade filter tabs */}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={() => setSelectedGrade(null)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedGrade === null
              ? 'bg-indigo-600 text-white'
              : 'bg-[#161b22] text-slate-400 border border-[#30363d] hover:border-indigo-500'
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
                ? 'bg-indigo-600 text-white'
                : 'bg-[#161b22] text-slate-400 border border-[#30363d] hover:border-indigo-500'
            }`}
          >
            G{grade}
          </button>
        ))}
      </div>

      {/* Story grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {stories.map((story) => (
          <div
            key={story.id}
            className="bg-[#161b22] rounded-xl overflow-hidden border border-[#30363d] hover:border-indigo-500 transition-all cursor-pointer group"
            onClick={() => onStartReading(story)}
          >
            <div className="h-40 overflow-hidden relative">
              <img
                src={story.thumbnail}
                alt={story.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              {/* Grade badge */}
              {story.grade && (
                <div className="absolute top-2 right-2 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded">
                  G{story.grade}
                </div>
              )}
            </div>
            <div className="p-4">
              <h4 className="text-white font-bold mb-1">{story.title}</h4>
              <div className="text-[10px] text-slate-500 font-mono">{story.filename}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {stories.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p>沒有找到符合條件的讀本</p>
        </div>
      )}
    </div>
  );
};

export default StoryLibrary;
