import React from 'react';

export type ViewMode = 'class' | 'student';

interface CrossTextFilterBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function CrossTextFilterBar({ viewMode, onViewModeChange }: CrossTextFilterBarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500 font-medium">檢視模式：</span>
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        <button
          onClick={() => onViewModeChange('class')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === 'class'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          班級總覽
        </button>
        <button
          onClick={() => onViewModeChange('student')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === 'student'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          個別學生
        </button>
      </div>
    </div>
  );
}
