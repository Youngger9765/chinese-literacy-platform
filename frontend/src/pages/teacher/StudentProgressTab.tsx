import React from 'react';
import { StudentProgress } from '../../services/teacherApi';
import StudentDialogueModal from './components/StudentDialogueModal';
import StudentExpandedPanel from './components/StudentExpandedPanel';
import StudentProgressCard from './components/StudentProgressCard';
import StudentTagManager from './components/StudentTagManager';
import { formatDate, tagColorClass } from './components/studentProgressUtils';
import { useStudentProgress } from './hooks/useStudentProgress';
import TeacherInstructionPanel from './TeacherInstructionPanel';

interface StudentProgressTabProps {
  classroomId: number;
}

const StudentProgressTab: React.FC<StudentProgressTabProps> = ({ classroomId }) => {
  const {
    progress,
    isLoading,
    error,
    exporting,
    expandedStudentId,
    isLoadingSessions,
    sessions,
    sessionsError,
    dialogueModal,
    setDialogueModal,
    loadingDialogueSessionId,
    dialogueError,
    setDialogueError,
    instructionTarget,
    setInstructionTarget,
    instructionCounts,
    tagManagerStudent,
    setTagManagerStudent,
    learningCurve,
    isLoadingCurve,
    curveError,
    curveStoryFilter,
    setCurveStoryFilter,
    availableStories,
    loadProgress,
    loadInstructionCounts,
    loadDialogue,
    exportReport,
    handleRowClick,
    handleTagsChanged,
    addTag,
    removeTag,
  } = useStudentProgress(classroomId);

  const openInstruction = (student: StudentProgress) => {
    setInstructionTarget({ id: student.student_id, name: student.student_name });
  };

  const renderExpandedPanel = (student: StudentProgress, variant: 'mobile' | 'desktop') => (
    <StudentExpandedPanel
      classroomId={classroomId}
      studentId={student.student_id}
      studentName={student.student_name}
      sessions={sessions}
      isLoadingSessions={isLoadingSessions}
      sessionsError={sessionsError}
      learningCurve={learningCurve}
      isLoadingCurve={isLoadingCurve}
      curveError={curveError}
      curveStoryFilter={curveStoryFilter}
      availableStories={availableStories}
      loadingDialogueSessionId={loadingDialogueSessionId}
      onCurveStoryFilterChange={setCurveStoryFilter}
      onViewDialogue={loadDialogue}
      variant={variant}
    />
  );

  if (isLoading) {
    return (
      <div className="p-5 space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex gap-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/6" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5">
        <div className="text-center py-6 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadProgress}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  if (progress.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
          <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">尚無學生學習記錄</p>
        <p className="text-xs text-gray-500">學生開始練習後，進度將會顯示在這裡</p>
      </div>
    );
  }

  return (
    <div className="p-5">
      {tagManagerStudent && (
        <StudentTagManager
          studentId={tagManagerStudent.student_id}
          studentName={tagManagerStudent.student_name}
          currentTags={tagManagerStudent.tags}
          onClose={() => setTagManagerStudent(null)}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onTagsChanged={handleTagsChanged}
        />
      )}

      {dialogueError && (
        <div className="mb-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <span>對話紀錄載入失敗：{dialogueError}</span>
          <button
            type="button"
            onClick={() => setDialogueError(null)}
            className="ml-auto text-xs underline hover:no-underline"
          >
            關閉
          </button>
        </div>
      )}

      {dialogueModal && (
        <StudentDialogueModal
          data={dialogueModal.data}
          storyTitle={dialogueModal.storyTitle}
          studentName={dialogueModal.studentName}
          onClose={() => setDialogueModal(null)}
        />
      )}

      <div className="flex justify-end mb-3">
        <button
          onClick={exportReport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? '匯出中...' : '匯出 CSV'}
        </button>
      </div>

      <div className="md:hidden space-y-3">
        {progress.map((student) => {
          const isExpanded = expandedStudentId === student.student_id;
          return (
            <div key={student.student_id}>
              <StudentProgressCard
                student={student}
                isExpanded={isExpanded}
                instructionCount={instructionCounts[student.student_id] ?? 0}
                onExpand={handleRowClick}
                onTagManager={setTagManagerStudent}
                onInstruction={openInstruction}
              />
              {isExpanded && renderExpandedPanel(student, 'mobile')}
            </div>
          );
        })}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="pb-2 font-medium w-6"></th>
              <th className="pb-2 font-medium">學生姓名</th>
              <th className="pb-2 font-medium">最近練習日期</th>
              <th className="pb-2 font-medium">最近練習課文</th>
              <th className="pb-2 font-medium text-center">練習次數</th>
              <th className="pb-2 font-medium text-center w-10">指示</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {progress.map((student) => {
              const isExpanded = expandedStudentId === student.student_id;
              return (
                <React.Fragment key={student.student_id}>
                  <tr
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => handleRowClick(student.student_id)}
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
                    <td className="py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-900 font-medium">{student.student_name}</span>
                        {student.tags.map((tag) => (
                          <span
                            key={tag.tag_name}
                            className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium border ${tagColorClass(tag.color)}`}
                          >
                            {tag.tag_name}
                          </span>
                        ))}
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setTagManagerStudent(student);
                          }}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                          title="管理標籤"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          標籤
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5 text-gray-600">{formatDate(student.last_session_date)}</td>
                    <td className="py-2.5 text-gray-600">{student.last_text_title ?? '-'}</td>
                    <td className="py-2.5 text-gray-600 text-center">
                      <span className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                        student.total_sessions > 0
                          ? 'bg-accent-bg text-accent'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {student.total_sessions}
                      </span>
                    </td>
                    <td className="py-2.5 text-center">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          openInstruction(student);
                        }}
                        className="relative inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                        title="AI 教學指示"
                      >
                        留言
                        {(instructionCounts[student.student_id] ?? 0) > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-white bg-amber-500 rounded-full">
                            {instructionCounts[student.student_id]}
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-4 py-3">
                        {renderExpandedPanel(student, 'desktop')}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {instructionTarget && (
        <TeacherInstructionPanel
          studentId={instructionTarget.id}
          studentName={instructionTarget.name}
          classroomId={classroomId}
          onClose={() => {
            setInstructionTarget(null);
            loadInstructionCounts(progress);
          }}
        />
      )}
    </div>
  );
};

export default StudentProgressTab;
