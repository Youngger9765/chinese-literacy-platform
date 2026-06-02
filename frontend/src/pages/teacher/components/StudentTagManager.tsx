import React, { useState } from 'react';
import { StudentTag } from '../../../services/teacherApi';
import { tagColorClass } from './studentProgressUtils';

const PREDEFINED_TAGS: { name: string; color: string }[] = [
  { name: '需要關注', color: 'red' },
  { name: '閱讀困難', color: 'orange' },
  { name: '進步中', color: 'green' },
  { name: '資優', color: 'blue' },
];

export interface StudentTagManagerProps {
  studentId: number;
  studentName: string;
  currentTags: StudentTag[];
  onClose: () => void;
  onAddTag: (studentId: number, tagName: string, color: string) => Promise<StudentTag | null>;
  onRemoveTag: (studentId: number, tagName: string) => Promise<void>;
  onTagsChanged: (studentId: number, tags: StudentTag[]) => void;
}

export const StudentTagManager: React.FC<StudentTagManagerProps> = ({
  studentId,
  studentName,
  currentTags,
  onClose,
  onAddTag,
  onRemoveTag,
  onTagsChanged,
}) => {
  const [tags, setTags] = useState<StudentTag[]>(currentTags);
  const [customInput, setCustomInput] = useState('');
  const [customColor, setCustomColor] = useState('gray');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleAdd = async (tagName: string, color: string) => {
    if (tags.some((tag) => tag.tag_name === tagName)) return;
    setSaving(tagName);
    setError('');
    try {
      const newTag = await onAddTag(studentId, tagName, color);
      if (newTag) {
        const updated = [...tags, newTag];
        setTags(updated);
        onTagsChanged(studentId, updated);
      }
    } catch {
      setError('新增標籤失敗，請稍後再試');
    } finally {
      setSaving(null);
    }
  };

  const handleRemove = async (tagName: string) => {
    setSaving(tagName);
    setError('');
    try {
      await onRemoveTag(studentId, tagName);
      const updated = tags.filter((tag) => tag.tag_name !== tagName);
      setTags(updated);
      onTagsChanged(studentId, updated);
    } catch {
      setError('移除標籤失敗，請稍後再試');
    } finally {
      setSaving(null);
    }
  };

  const handleAddCustom = async () => {
    const name = customInput.trim();
    if (!name) return;
    if (name.length > 50) {
      setError('標籤名稱不能超過 50 字元');
      return;
    }
    await handleAdd(name, customColor);
    setCustomInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">
            管理標籤 — {studentName}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            aria-label="關閉"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {tags.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2">目前標籤</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag.tag_name}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${tagColorClass(tag.color)}`}
                >
                  {tag.tag_name}
                  <button
                    onClick={() => handleRemove(tag.tag_name)}
                    disabled={saving === tag.tag_name}
                    className="ml-0.5 hover:opacity-70 disabled:opacity-40 cursor-pointer"
                    aria-label={`移除 ${tag.tag_name}`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2">快速新增</p>
          <div className="flex flex-wrap gap-1.5">
            {PREDEFINED_TAGS.map((tag) => {
              const isActive = tags.some((current) => current.tag_name === tag.name);
              return (
                <button
                  key={tag.name}
                  onClick={() => isActive ? handleRemove(tag.name) : handleAdd(tag.name, tag.color)}
                  disabled={saving === tag.name}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-opacity disabled:opacity-50 cursor-pointer ${
                    isActive
                      ? tagColorClass(tag.color)
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {isActive && (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.172l7.879-7.879a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-2">自訂標籤</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customInput}
              onChange={(event) => setCustomInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleAddCustom()}
              placeholder="輸入標籤名稱..."
              maxLength={50}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <select
              value={customColor}
              onChange={(event) => setCustomColor(event.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            >
              <option value="gray">灰</option>
              <option value="red">紅</option>
              <option value="orange">橙</option>
              <option value="green">綠</option>
              <option value="blue">藍</option>
              <option value="purple">紫</option>
            </select>
            <button
              onClick={handleAddCustom}
              disabled={!customInput.trim() || saving !== null}
              className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              新增
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
    </div>
  );
};

export default StudentTagManager;
