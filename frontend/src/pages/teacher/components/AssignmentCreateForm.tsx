import React, { FormEvent } from 'react';
import ReadingGoalsForm, { GoalsFormState } from '../../../components/teacher/ReadingGoalsForm';
import { ZhTWDatePicker } from '../../../components/ui/ZhTWDatePicker';
import { Story } from '../../../types';

export interface AssignmentCreateFormProps {
  stories: Story[];
  storyGrade: string | null;   // "4".."9" / 文言文 / 品格教育
  isLoadingStories: boolean;
  storiesError: string | null;
  selectedStoryId: string;
  setSelectedStoryId: (value: string) => void;
  formTitle: string;
  setFormTitle: (value: string) => void;
  formDescription: string;
  setFormDescription: (value: string) => void;
  formDueDate: string;
  setFormDueDate: (value: string) => void;
  formSkipCompleted: boolean;
  setFormSkipCompleted: (value: boolean) => void;
  formGoals: GoalsFormState;
  setFormGoals: (value: GoalsFormState) => void;
  isCreating: boolean;
  createError: string;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onRetryStories: () => void;
}

export const AssignmentCreateForm: React.FC<AssignmentCreateFormProps> = ({
  stories,
  storyGrade,
  isLoadingStories,
  storiesError,
  selectedStoryId,
  setSelectedStoryId,
  formTitle,
  setFormTitle,
  formDescription,
  setFormDescription,
  formDueDate,
  setFormDueDate,
  formSkipCompleted,
  setFormSkipCompleted,
  formGoals,
  setFormGoals,
  isCreating,
  createError,
  onSubmit,
  onClose,
  onRetryStories,
}) => (
  <div className="p-5 border-b border-gray-100 bg-gray-50/50">
    <div className="flex items-center justify-between mb-3">
      <h4 className="text-sm font-bold text-gray-900">建立新作業</h4>
      <button
        onClick={onClose}
        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
      >
        關閉
      </button>
    </div>

    {createError && (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-3">
        {createError}
      </div>
    )}

    <form onSubmit={onSubmit} className="space-y-4">

      {/* Group A: 基本資訊 */}
      <fieldset>
        <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">基本資訊</legend>
        <div className="space-y-3">
          <div>
            <label htmlFor="assign-story" className="block text-sm font-medium text-gray-700 mb-1">
              課文 <span className="text-red-500">*</span>
            </label>
            {isLoadingStories ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-400">載入課文列表...</span>
              </div>
            ) : storiesError ? (
              <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <span>載入課文失敗：{storiesError}</span>
                <button
                  type="button"
                  onClick={onRetryStories}
                  className="ml-auto text-xs underline hover:no-underline"
                >
                  重試
                </button>
              </div>
            ) : (
              <select
                id="assign-story"
                value={selectedStoryId}
                onChange={(event) => setSelectedStoryId(event.target.value)}
                required
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              >
                <option value="">選擇課文</option>
                {stories.map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.title}
                    {story.grade ? ` (${story.grade}年級)` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor="assign-title" className="block text-sm font-medium text-gray-700 mb-1">
              作業標題（選填）
            </label>
            <input
              id="assign-title"
              type="text"
              value={formTitle}
              onChange={(event) => setFormTitle(event.target.value)}
              placeholder="留空則使用課文標題"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label htmlFor="assign-desc" className="block text-sm font-medium text-gray-700 mb-1">
              說明（選填）
            </label>
            <textarea
              id="assign-desc"
              value={formDescription}
              onChange={(event) => setFormDescription(event.target.value)}
              placeholder="作業說明或提示"
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors resize-none"
            />
          </div>
        </div>
      </fieldset>

      {/* Group B: 設定選項 */}
      <fieldset className="border-t border-gray-100 pt-3">
        <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">設定選項</legend>
        <div className="space-y-3">
          <div>
            <label htmlFor="assign-due" className="block text-sm font-medium text-gray-700 mb-1">
              截止日期（選填）
            </label>
            <ZhTWDatePicker
              id="assign-due"
              value={formDueDate}
              onChange={setFormDueDate}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="assign-skip-completed"
              type="checkbox"
              checked={formSkipCompleted}
              onChange={(event) => setFormSkipCompleted(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
            />
            <label htmlFor="assign-skip-completed" className="text-sm text-gray-700 cursor-pointer select-none">
              跳過已完成步驟（學生重做作業時自動略過上次完成的環節）
            </label>
          </div>
        </div>
      </fieldset>

      {/* Group C: 朗讀目標 */}
      <fieldset className="border-t border-gray-100 pt-3">
        <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">朗讀目標</legend>
        <ReadingGoalsForm
          value={formGoals}
          onChange={setFormGoals}
            /* ReadingGoalsForm derives a CPM target from the school year.
               文言文 / 品格教育 have no year, so they fall through to the
               default instead of borrowing another grade's target. */
            grade={selectedStoryId && storyGrade && /^\d+$/.test(storyGrade)
              ? Number(storyGrade)
              : null}
        />
      </fieldset>

      <div className="flex gap-3 justify-end pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isCreating || !selectedStoryId}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
        >
          {isCreating ? '建立中...' : '確認建立'}
        </button>
      </div>
    </form>
  </div>
);

export default AssignmentCreateForm;
