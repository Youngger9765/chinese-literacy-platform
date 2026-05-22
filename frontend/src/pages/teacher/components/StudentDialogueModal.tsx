import React from 'react';
import {
  TeacherDialogueHistoryResponse,
  TeacherDialogueTurn,
} from '../../../services/teacherApi';

const PHASE_LABEL: Record<string, string> = {
  factual: '事實理解',
  inferential: '推論思考',
  evaluative: '評估反思',
};

const DialogueTurnRow: React.FC<{ turn: TeacherDialogueTurn }> = ({ turn }) => {
  if (turn.role === 'ai') {
    return (
      <div className="flex gap-2.5">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center mt-0.5">
          <span className="text-white text-[9px] font-bold">AI</span>
        </div>
        <div className="flex-1 max-w-[85%]">
          {turn.phase && (
            <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-bg text-accent">
              {PHASE_LABEL[turn.phase] ?? turn.phase}
            </span>
          )}
          <div className="bg-accent-bg border border-accent-bg-subtle rounded-2xl rounded-tl-sm px-3.5 py-2.5">
            <p className="text-sm text-accent-hover leading-relaxed">{turn.text}</p>
          </div>
        </div>
      </div>
    );
  }

  if (turn.role === 'student') {
    return (
      <div className="flex gap-2.5 flex-row-reverse">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center mt-0.5">
          <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div className="max-w-[85%]">
          <div className="bg-accent rounded-2xl rounded-tr-sm px-3.5 py-2.5">
            <p className="text-sm text-white leading-relaxed">{turn.text}</p>
          </div>
        </div>
      </div>
    );
  }

  if (turn.role === 'feedback') {
    return (
      <div className="mx-8">
        <div className={`rounded-xl px-3 py-2 text-xs border ${
          turn.is_correct
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <span className="mr-1">{turn.is_correct ? '✓' : '💡'}</span>
          {turn.text}
        </div>
      </div>
    );
  }

  return null;
};

export interface StudentDialogueModalProps {
  data: TeacherDialogueHistoryResponse;
  storyTitle: string | null;
  studentName: string;
  onClose: () => void;
}

export const StudentDialogueModal: React.FC<StudentDialogueModalProps> = ({
  data,
  storyTitle,
  studentName,
  onClose,
}) => {
  const headerTitle = storyTitle
    ? `${studentName} — 《${storyTitle}》對話紀錄`
    : `${studentName} — 對話紀錄`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="學生對話紀錄"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800 truncate">{headerTitle}</h2>
            <p className="text-xs text-gray-400 mt-0.5">共 {data.total} 則訊息</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉對話紀錄"
            className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {data.turns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">這次學習沒有對話記錄</p>
            </div>
          ) : (
            data.turns.map((turn) => <DialogueTurnRow key={turn.id} turn={turn} />)
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentDialogueModal;
