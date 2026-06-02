import React from 'react';
import type { TeacherTextItem } from '../../../services/teacherTextsApi';
import { GENRES, GRADES } from '../teacherTextFormMapper';

interface MyTextsListProps {
  texts: TeacherTextItem[];
  total: number;
  isLoading: boolean;
  listError: string;
  isLoadingPreview: boolean;
  searchQuery: string;
  filterGrade: number | '';
  filterGenre: string;
  onSearchChange: (v: string) => void;
  onGradeChange: (v: number | '') => void;
  onGenreChange: (v: string) => void;
  onCreateClick: () => void;
  onEditClick: (id: number) => void;
  onPreviewClick: (id: number) => void;
  onDeleteClick: (id: number) => void;
}

const MyTextsList: React.FC<MyTextsListProps> = ({
  texts,
  total,
  isLoading,
  listError,
  isLoadingPreview,
  searchQuery,
  filterGrade,
  filterGenre,
  onSearchChange,
  onGradeChange,
  onGenreChange,
  onCreateClick,
  onEditClick,
  onPreviewClick,
  onDeleteClick,
}) => (
  <>
    <div className="flex flex-wrap gap-3">
      <input
        type="text"
        placeholder="搜尋課文標題..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-48"
      />
      <select
        value={filterGrade}
        onChange={(e) => onGradeChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="">所有年級</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>{g} 年級</option>
        ))}
      </select>
      <select
        value={filterGenre}
        onChange={(e) => onGenreChange(e.target.value)}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="">所有體裁</option>
        {GENRES.map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
    </div>

    {listError && (
      <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
        {listError}
      </div>
    )}

    {isLoading ? (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    ) : texts.length === 0 ? (
      <div className="text-center py-16 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        <p className="text-sm">尚無自建課文</p>
        <button onClick={onCreateClick} className="mt-3 text-indigo-600 text-sm hover:underline">
          建立第一篇課文
        </button>
      </div>
    ) : (
      <>
        <p className="text-xs text-gray-400">共 {total} 篇課文</p>
        <div className="grid gap-3">
          {texts.map((text) => (
            <div
              key={text.id}
              className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:shadow-sm transition-shadow"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-800 truncate">{text.title}</span>
                  <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full shrink-0">
                    {text.grade} 年級
                  </span>
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full shrink-0">
                    {text.genre}
                  </span>
                  <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${
                    text.status === 'published' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
                  }`}>
                    {text.status === 'published' ? '已發布' : '草稿'}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {text.paragraph_count} 段 · {text.char_count} 字 ·
                  更新於 {new Date(text.updated_at).toLocaleDateString('zh-TW')}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <button
                  onClick={() => onPreviewClick(text.id)}
                  className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  disabled={isLoadingPreview}
                >
                  預覽
                </button>
                <button
                  onClick={() => onEditClick(text.id)}
                  className="px-3 py-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  編輯
                </button>
                <button
                  onClick={() => onDeleteClick(text.id)}
                  className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      </>
    )}
  </>
);

export default MyTextsList;
