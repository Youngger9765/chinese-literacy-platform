/**
 * StoryTagEditor — teacher UI to set difficulty and custom tags on a story.
 * Issue #422
 */
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getStoryTag,
  upsertStoryTag,
  deleteStoryTag,
  StoryTagData,
  TeacherApiError,
} from '../../services/teacherApi';

type Difficulty = 'easy' | 'medium' | 'hard';

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string; className: string }[] = [
  { value: 'easy', label: '入門', className: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'medium', label: '中階', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'hard', label: '進階', className: 'bg-red-100 text-red-700 border-red-200' },
];

const MAX_CUSTOM_TAGS = 10;
const MAX_TAG_LENGTH = 30;

interface StoryTagEditorProps {
  /** lesson_number string for platform stories, or "text:{id}" for teacher texts */
  storyRef: string;
  storyTitle: string;
  onClose: () => void;
  onSaved?: (data: StoryTagData) => void;
}

const StoryTagEditor: React.FC<StoryTagEditorProps> = ({
  storyRef,
  storyTitle,
  onClose,
  onSaved,
}) => {
  const { token } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    getStoryTag(token, storyRef)
      .then((data) => {
        setDifficulty(data.difficulty_level ?? null);
        setCustomTags(data.custom_tags ?? []);
      })
      .catch(() => {
        // Non-critical — start with empty state
        setDifficulty(null);
        setCustomTags([]);
      })
      .finally(() => setIsLoading(false));
  }, [token, storyRef]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_TAG_LENGTH) {
      setError(`標籤不能超過 ${MAX_TAG_LENGTH} 個字`);
      return;
    }
    if (customTags.includes(trimmed)) {
      setError('標籤已存在');
      return;
    }
    if (customTags.length >= MAX_CUSTOM_TAGS) {
      setError(`最多只能設定 ${MAX_CUSTOM_TAGS} 個標籤`);
      return;
    }
    setCustomTags((prev) => [...prev, trimmed]);
    setTagInput('');
    setError('');
    inputRef.current?.focus();
  };

  const handleRemoveTag = (tag: string) => {
    setCustomTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSave = async () => {
    if (!token) return;
    setIsSaving(true);
    setError('');
    try {
      const saved = await upsertStoryTag(token, storyRef, {
        difficulty_level: difficulty,
        custom_tags: customTags,
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('儲存失敗，請稍後再試');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAll = async () => {
    if (!token) return;
    setIsSaving(true);
    setError('');
    try {
      await deleteStoryTag(token, storyRef);
      setDifficulty(null);
      setCustomTags([]);
      onSaved?.({ story_ref: storyRef, difficulty_level: null, custom_tags: [] });
      onClose();
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('清除失敗，請稍後再試');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`設定標籤：${storyTitle}`}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">設定標籤</h3>
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{storyTitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="關閉"
            className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5 shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Difficulty selector */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">難度設定</p>
              <p className="text-xs text-gray-400 mb-3">
                預設依年級自動判斷。設定後將覆蓋自動難度，顯示在課文卡片上。
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setDifficulty(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    difficulty === null
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  自動 (依年級)
                </button>
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDifficulty(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      difficulty === opt.value
                        ? `${opt.className} border-current`
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom tags */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">自訂標籤</p>
              <p className="text-xs text-gray-400 mb-3">
                例：「重要考題」「期末複習」。最多 {MAX_CUSTOM_TAGS} 個，每個不超過 {MAX_TAG_LENGTH} 字。
              </p>

              {/* Tag chips */}
              {customTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {customTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        aria-label={`移除標籤 ${tag}`}
                        className="hover:text-red-500 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Tag input */}
              {customTags.length < MAX_CUSTOM_TAGS && (
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setError('');
                    }}
                    onKeyDown={handleTagInputKeyDown}
                    placeholder="輸入標籤後按 Enter 或點「新增」"
                    maxLength={MAX_TAG_LENGTH}
                    className="flex-1 text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                  <button
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                    className="px-3 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    新增
                  </button>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleClearAll}
                disabled={isSaving}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
              >
                清除所有標籤
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StoryTagEditor;
