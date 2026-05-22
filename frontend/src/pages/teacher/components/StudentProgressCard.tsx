import React from 'react';
import { StudentProgress } from '../../../services/teacherApi';
import { formatDate, tagColorClass } from './studentProgressUtils';

export interface StudentProgressCardProps {
  student: StudentProgress;
  isExpanded: boolean;
  instructionCount: number;
  onExpand: (studentId: number) => void;
  onTagManager: (student: StudentProgress) => void;
  onInstruction: (student: StudentProgress) => void;
}

export const StudentProgressCard: React.FC<StudentProgressCardProps> = ({
  student,
  isExpanded,
  instructionCount,
  onExpand,
  onTagManager,
  onInstruction,
}) => (
  <div
    className="bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:border-gray-300 transition-colors"
    onClick={() => onExpand(student.student_id)}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-900">{student.student_name}</span>
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
              onTagManager(student);
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
      </div>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onInstruction(student);
        }}
        className="relative inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors shrink-0"
        title="AI 教學指示"
      >
        留言
        {instructionCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-white bg-amber-500 rounded-full">
            {instructionCount}
          </span>
        )}
      </button>
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
      <div>
        <span className="text-xs text-gray-400">最近練習日期</span>
        <p className="text-gray-700">{formatDate(student.last_session_date)}</p>
      </div>
      <div>
        <span className="text-xs text-gray-400">最近課文</span>
        <p className="text-gray-700 truncate">{student.last_text_title ?? '-'}</p>
      </div>
      <div>
        <span className="text-xs text-gray-400">練習次數</span>
        <p>
          <span className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
            student.total_sessions > 0 ? 'bg-accent-bg text-accent' : 'bg-gray-100 text-gray-500'
          }`}>{student.total_sessions}</span>
        </p>
      </div>
    </div>
  </div>
);

export default StudentProgressCard;
