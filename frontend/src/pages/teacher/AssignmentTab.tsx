import React from 'react';
import { AssignmentResponse } from '../../services/assignmentApi';
import AssignmentCard from './components/AssignmentCard';
import AssignmentCreateForm from './components/AssignmentCreateForm';
import AssignmentExpandedPanel from './components/AssignmentExpandedPanel';
import AssignmentInlineEdit from './components/AssignmentInlineEdit';
import { completionPercentage, formatDate, isOverdue } from './components/assignmentUtils';
import { StatusFilter, useAssignments } from './hooks/useAssignments';

interface AssignmentTabProps {
  classroomId: number;
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '進行中' },
  { key: 'overdue', label: '已逾期' },
  { key: 'inactive', label: '已停用' },
];

const AssignmentTab: React.FC<AssignmentTabProps> = ({ classroomId }) => {
  const {
    assignments,
    isLoading,
    error,
    setError,
    statusFilter,
    setStatusFilter,
    showCreateForm,
    setShowCreateForm,
    allStories,
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
    expandedId,
    expandedDetail,
    isLoadingDetail,
    deletingId,
    confirmDeleteId,
    setConfirmDeleteId,
    editingId,
    editTitle,
    setEditTitle,
    editDescription,
    setEditDescription,
    editDueDate,
    setEditDueDate,
    isSavingEdit,
    editError,
    storyMap,
    filteredAssignments,
    tabCounts,
    loadAssignments,
    retryLoadStories,
    handleOpenCreateForm,
    handleCreate,
    handleToggleActive,
    handleDelete,
    handleOpenEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleExpand,
    handleGraded,
  } = useAssignments(classroomId);

  const renderEditForm = (assignment: AssignmentResponse, variant: 'mobile' | 'desktop') => (
    <AssignmentInlineEdit
      editTitle={editTitle}
      setEditTitle={setEditTitle}
      editDescription={editDescription}
      setEditDescription={setEditDescription}
      editDueDate={editDueDate}
      setEditDueDate={setEditDueDate}
      editError={editError}
      isSavingEdit={isSavingEdit}
      onCancel={handleCancelEdit}
      onSave={() => handleSaveEdit(assignment.id)}
      variant={variant}
    />
  );

  const renderDesktopRow = (assignment: AssignmentResponse) => {
    const isExpanded = expandedId === assignment.id;
    const displayTitle = assignment.title || assignment.story_title;
    const completionPct = completionPercentage(assignment.completed_count, assignment.submission_count);
    const isConfirmingDelete = confirmDeleteId === assignment.id;
    const isDeleting = deletingId === assignment.id;
    const isEditing = editingId === assignment.id;

    return (
      <React.Fragment key={assignment.id}>
        <tr
          className="cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => {
            if (isConfirmingDelete || isEditing) return;
            handleExpand(assignment.id);
          }}
        >
          <td className="py-2.5 text-gray-400">
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </td>
          <td className="py-2.5 text-gray-900 font-medium">{displayTitle}</td>
          <td className="py-2.5 text-gray-600">{assignment.story_title}</td>
          <td className="py-2.5 text-gray-600">
            <span className={isOverdue(assignment.due_date) ? 'text-red-600' : ''}>
              {formatDate(assignment.due_date)}
            </span>
            {isOverdue(assignment.due_date) && (
              <span className="ml-1 inline-block px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                已逾期
              </span>
            )}
          </td>
          <td className="py-2.5 text-center">
            <span
              className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                completionPct === 100
                  ? 'bg-green-100 text-green-700'
                  : completionPct > 0
                    ? 'bg-accent-bg text-accent'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              {assignment.completed_count}/{assignment.submission_count}
            </span>
          </td>
          <td className="py-2.5 text-center">
            <button
              onClick={(event) => {
                event.stopPropagation();
                handleToggleActive(assignment);
              }}
              className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                assignment.is_active
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {assignment.is_active ? '進行中' : '已停用'}
            </button>
          </td>
          <td className="py-2.5 text-center" onClick={(event) => event.stopPropagation()}>
            {isConfirmingDelete ? (
              <div className="flex items-center gap-1 justify-center">
                <button
                  onClick={() => handleDelete(assignment)}
                  disabled={isDeleting}
                  className="px-1.5 py-0.5 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {isDeleting ? '...' : '確認'}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 justify-center">
                <button
                  onClick={() => handleOpenEdit(assignment)}
                  className="p-1 rounded text-gray-400 hover:text-accent hover:bg-accent-bg transition-colors cursor-pointer"
                  title="編輯作業"
                  aria-label="編輯作業"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button
                  onClick={() => setConfirmDeleteId(assignment.id)}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                  title="刪除作業"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </td>
        </tr>

        {isEditing && (
          <tr>
            <td colSpan={7} className="bg-blue-50 px-4 py-3 border-b border-blue-100">
              {renderEditForm(assignment, 'desktop')}
            </td>
          </tr>
        )}

        {isExpanded && (
          <tr>
            <td colSpan={7} className="bg-gray-50 px-4 py-3">
              <AssignmentExpandedPanel
                assignment={assignment}
                expandedDetail={expandedDetail}
                isLoadingDetail={isLoadingDetail}
                onGraded={handleGraded}
              />
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex gap-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/6" />
          </div>
        ))}
      </div>
    );
  }

  if (error && assignments.length === 0) {
    return (
      <div className="p-5">
        <div className="text-center py-6 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadAssignments}
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
      {error && (
        <div className="mx-5 mt-5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">
            關閉
          </button>
        </div>
      )}

      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          共 {assignments.length} 份作業
        </span>
        {!showCreateForm && (
          <button
            onClick={handleOpenCreateForm}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            建立作業
          </button>
        )}
      </div>

      {showCreateForm && (
        <AssignmentCreateForm
          stories={allStories}
          storyGrade={selectedStoryId ? storyMap.get(selectedStoryId)?.grade ?? null : null}
          isLoadingStories={isLoadingStories}
          storiesError={storiesError}
          selectedStoryId={selectedStoryId}
          setSelectedStoryId={setSelectedStoryId}
          formTitle={formTitle}
          setFormTitle={setFormTitle}
          formDescription={formDescription}
          setFormDescription={setFormDescription}
          formDueDate={formDueDate}
          setFormDueDate={setFormDueDate}
          formSkipCompleted={formSkipCompleted}
          setFormSkipCompleted={setFormSkipCompleted}
          formGoals={formGoals}
          setFormGoals={setFormGoals}
          isCreating={isCreating}
          createError={createError}
          onSubmit={handleCreate}
          onClose={() => setShowCreateForm(false)}
          onRetryStories={retryLoadStories}
        />
      )}

      {assignments.length > 0 && (
        <div className="px-5 pt-4 pb-0 flex gap-1 border-b border-gray-100">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
                statusFilter === tab.key
                  ? 'border-accent text-accent bg-accent-bg'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              {tabCounts[tab.key] > 0 && (
                <span
                  className={`ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-xs ${
                    statusFilter === tab.key
                      ? 'bg-accent text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {tabCounts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {filteredAssignments.length === 0 ? (
        <div className="p-8 text-center">
          {assignments.length === 0 ? (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
                <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-1.125 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">尚未建立作業</p>
              <p className="text-xs text-gray-500">點選「建立作業」為班級指派學習任務</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">此分類下沒有作業</p>
          )}
        </div>
      ) : (
        <div className="p-5">
          <div className="md:hidden space-y-3">
            {filteredAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                isExpanded={expandedId === assignment.id}
                isConfirmingDelete={confirmDeleteId === assignment.id}
                isDeleting={deletingId === assignment.id}
                isEditing={editingId === assignment.id}
                editTitle={editTitle}
                setEditTitle={setEditTitle}
                editDescription={editDescription}
                setEditDescription={setEditDescription}
                editDueDate={editDueDate}
                setEditDueDate={setEditDueDate}
                editError={editError}
                isSavingEdit={isSavingEdit}
                expandedDetail={expandedDetail}
                isLoadingDetail={isLoadingDetail}
                onExpand={handleExpand}
                onToggleActive={handleToggleActive}
                onEdit={handleOpenEdit}
                onCancelEdit={handleCancelEdit}
                onSaveEdit={handleSaveEdit}
                onDelete={handleDelete}
                onConfirmDelete={setConfirmDeleteId}
                onGraded={handleGraded}
              />
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="pb-2 font-medium w-6"></th>
                  <th className="pb-2 font-medium">作業名稱</th>
                  <th className="pb-2 font-medium">課文</th>
                  <th className="pb-2 font-medium">截止日期</th>
                  <th className="pb-2 font-medium text-center">完成率</th>
                  <th className="pb-2 font-medium text-center">狀態</th>
                  <th className="pb-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredAssignments.map(renderDesktopRow)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssignmentTab;
