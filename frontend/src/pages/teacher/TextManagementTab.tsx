import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomTexts,
  assignText,
  unassignText,
  ClassroomTextItem,
  TeacherApiError,
} from '../../services/teacherApi';
import { fetchStories } from '../../services/api';
import type { Story } from '../../types';

interface TextManagementTabProps {
  classroomId: number;
}

const TextManagementTab: React.FC<TextManagementTabProps> = ({ classroomId }) => {
  const { token } = useAuth();

  // Assigned texts
  const [assignedTexts, setAssignedTexts] = useState<ClassroomTextItem[]>([]);
  const [isLoadingTexts, setIsLoadingTexts] = useState(true);
  const [textsError, setTextsError] = useState('');

  // All available stories
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);

  // Assign flow
  const [showAssignSelector, setShowAssignSelector] = useState(false);
  const [assigningTextId, setAssigningTextId] = useState<string | null>(null);

  // Unassign flow
  const [confirmUnassignId, setConfirmUnassignId] = useState<string | null>(null);
  const [unassigningTextId, setUnassigningTextId] = useState<string | null>(null);

  const loadTexts = useCallback(async () => {
    if (!token) return;
    setIsLoadingTexts(true);
    setTextsError('');
    try {
      const data = await getClassroomTexts(token, classroomId);
      setAssignedTexts(data);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setTextsError(err.message);
      } else {
        setTextsError('無法載入課文列表');
      }
    } finally {
      setIsLoadingTexts(false);
    }
  }, [token, classroomId]);

  const loadStories = useCallback(async () => {
    if (allStories.length > 0) return; // already loaded
    setIsLoadingStories(true);
    try {
      const data = await fetchStories();
      setAllStories(data.stories);
    } catch {
      // silent -- selector will show empty
    } finally {
      setIsLoadingStories(false);
    }
  }, [allStories.length]);

  useEffect(() => {
    loadTexts();
  }, [loadTexts]);

  // Filter out already-assigned stories
  const assignedTextIds = useMemo(
    () => new Set(assignedTexts.map((t) => t.text_id)),
    [assignedTexts],
  );

  const availableStories = useMemo(
    () => allStories.filter((s) => !assignedTextIds.has(s.id)),
    [allStories, assignedTextIds],
  );

  const handleOpenAssignSelector = () => {
    setShowAssignSelector(true);
    loadStories();
  };

  const handleAssign = async (textId: string) => {
    if (!token) return;
    setAssigningTextId(textId);
    try {
      const newItem = await assignText(token, classroomId, textId);
      setAssignedTexts((prev) => [...prev, newItem]);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setTextsError(err.message);
      } else {
        setTextsError('指派課文失敗');
      }
    } finally {
      setAssigningTextId(null);
    }
  };

  const handleUnassign = async (textId: string) => {
    if (!token) return;

    // First click: show confirmation
    if (confirmUnassignId !== textId) {
      setConfirmUnassignId(textId);
      return;
    }

    // Second click: confirmed
    setUnassigningTextId(textId);
    try {
      await unassignText(token, classroomId, textId);
      setAssignedTexts((prev) => prev.filter((t) => t.text_id !== textId));
      setConfirmUnassignId(null);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setTextsError(err.message);
      } else {
        setTextsError('移除課文失敗');
      }
    } finally {
      setUnassigningTextId(null);
    }
  };

  const formatDate = (dateStr: string): string =>
    new Date(dateStr).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  if (isLoadingTexts) {
    return (
      <div className="p-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/6" />
          </div>
        ))}
      </div>
    );
  }

  if (textsError && assignedTexts.length === 0) {
    return (
      <div className="p-5">
        <div className="text-center py-6 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 text-sm">{textsError}</p>
          <button
            onClick={loadTexts}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Inline error */}
      {textsError && (
        <div className="mx-5 mt-5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {textsError}
          <button onClick={() => setTextsError('')} className="ml-2 underline cursor-pointer">
            關閉
          </button>
        </div>
      )}

      {/* Assign button row */}
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          已指派 {assignedTexts.length} 篇課文
        </span>
        {!showAssignSelector && (
          <button
            onClick={handleOpenAssignSelector}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            指派課文
          </button>
        )}
      </div>

      {/* Assign selector */}
      {showAssignSelector && (
        <div className="p-5 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-gray-900">選擇課文指派</h4>
            <button
              onClick={() => setShowAssignSelector(false)}
              className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              關閉
            </button>
          </div>
          {isLoadingStories ? (
            <div className="flex items-center gap-2 py-4">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-400">載入課文列表...</span>
            </div>
          ) : availableStories.length === 0 ? (
            <p className="text-xs text-gray-400 py-4">所有課文皆已指派</p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
              {availableStories.map((story) => (
                <div key={story.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{story.title}</p>
                    <p className="text-xs text-gray-500">
                      {story.grade ? `${story.grade} 年級` : ''}
                      {story.genre ? ` / ${story.genre}` : ''}
                      {story.charCount ? ` / ${story.charCount} 字` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleAssign(story.id)}
                    disabled={assigningTextId === story.id}
                    className="px-3 py-1 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {assigningTextId === story.id ? '指派中...' : '指派'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assigned text list */}
      {assignedTexts.length === 0 ? (
        <div className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
            <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">尚未指派課文</p>
          <p className="text-xs text-gray-500">點選「指派課文」為班級指定學習內容</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {assignedTexts.map((text) => (
            <div key={text.text_id} className="px-5 py-3 flex items-center justify-between group">
              <div>
                <p className="text-sm font-medium text-gray-900">{text.title}</p>
                <p className="text-xs text-gray-500">
                  指派於 {formatDate(text.assigned_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {confirmUnassignId === text.text_id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleUnassign(text.text_id)}
                      disabled={unassigningTextId === text.text_id}
                      className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {unassigningTextId === text.text_id ? '移除中...' : '確認移除'}
                    </button>
                    <button
                      onClick={() => setConfirmUnassignId(null)}
                      className="px-2 py-0.5 rounded text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleUnassign(text.text_id)}
                    className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    移除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TextManagementTab;
