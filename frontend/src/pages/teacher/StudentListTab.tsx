import React, { useState } from 'react';
import type { ClassroomDetailResponse, StudentInClassroomResponse } from '../../services/classroomApi';
import CsvUploadModal from './CsvUploadModal';
import AddStudentsPanel from './panel/AddStudentsPanel';
import { resetStudentPassword } from '../../services/classroomApi';
import { generateParentInviteCode } from '../../services/parentApi';

// ── Per-student parent invite button ─────────────────────────────────────────

const ParentInviteButton: React.FC<{ token: string; studentId: number; studentName: string }> = ({
  token,
  studentId,
  studentName,
}) => {
  const [code, setCode] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError('');
    try {
      const result = await generateParentInviteCode(token, studentId);
      setCode(result.code);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '產生失敗');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (code) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">
          {code}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors cursor-pointer"
          title={`複製 ${studentName} 的家長邀請碼`}
        >
          {copied ? '已複製' : '複製'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {isGenerating ? '產生中…' : '家長邀請碼'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
};

// ── Per-student password reset button ────────────────────────────────────────

const ResetPasswordButton: React.FC<{
  token: string;
  classroomId: number;
  studentId: number;
  studentName: string;
}> = ({ token, classroomId, studentId, studentName }) => {
  const [result, setResult] = useState<{ username: string; email: string; password: string } | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    if (!window.confirm(`確定要重設「${studentName}」的密碼嗎？`)) return;
    setIsResetting(true);
    setError('');
    try {
      setResult(await resetStudentPassword(token, classroomId, studentId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '重設密碼失敗');
    } finally {
      setIsResetting(false);
    }
  };

  if (result) {
    return (
      <div className="flex flex-col items-end gap-0.5 text-xs">
        <span className="font-mono text-gray-700">帳號：{result.username}</span>
        <span className="font-mono text-gray-700">新密碼：{result.password}</span>
        <span className="text-gray-500">密碼只會顯示這一次，請抄下來</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={handleReset}
        disabled={isResetting}
        className="text-xs text-amber-600 hover:text-amber-800 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {isResetting ? '重設中…' : '重設密碼'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
};

interface StudentListTabProps {
  classroom: ClassroomDetailResponse;
  token: string;
  studentIdInput: string;
  setStudentIdInput: (v: string) => void;
  isAddingStudent: boolean;
  addStudentError: string;
  setAddStudentError: (v: string) => void;
  onAddStudent: (e: React.FormEvent) => void;
  removingStudentId: number | null;
  onRemoveStudent: (s: StudentInClassroomResponse) => void;
  setRemovingStudentId: (id: number | null) => void;
  formatDate: (d: string) => string;
  onStudentsImported: () => void;
}

const StudentListTab: React.FC<StudentListTabProps> = ({
  classroom,
  token,
  studentIdInput,
  setStudentIdInput,
  isAddingStudent,
  addStudentError,
  setAddStudentError,
  onAddStudent,
  removingStudentId,
  onRemoveStudent,
  setRemovingStudentId,
  formatDate,
  onStudentsImported,
}) => {
  const [showCsvModal, setShowCsvModal] = useState(false);

  return (
    <>
      {/* CSV upload modal */}
      {showCsvModal && (
        <CsvUploadModal
          token={token}
          classroomId={classroom.id}
          onClose={() => setShowCsvModal(false)}
          onSuccess={() => {
            setShowCsvModal(false);
            onStudentsImported();
          }}
        />
      )}

      {/* 加學生 —— 均一模式：先問「學生有沒有帳號」(#3378) */}
      <AddStudentsPanel
        token={token}
        classroomId={classroom.id}
        classroomName={classroom.name}
        joinCode={classroom.join_code}
        nextSeat={classroom.students.length + 1}
        onCreated={onStudentsImported}
        onOpenCsv={() => setShowCsvModal(true)}
        addByIdForm={
          <>
            <form onSubmit={onAddStudent} className="flex gap-3 items-end">
              <div className="flex-1">
                <input
                  id="add-student-id"
                  type="text"
                  value={studentIdInput}
                  onChange={(e) => {
                    setStudentIdInput(e.target.value);
                    setAddStudentError('');
                  }}
                  placeholder="輸入學生編號"
                  className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={isAddingStudent || !studentIdInput.trim()}
                className="h-10 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 rounded-lg font-medium text-sm transition-colors shrink-0"
              >
                {isAddingStudent ? '新增中...' : '新增'}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-1">學生可在個人資料頁面查看自己的編號</p>
            {addStudentError && (
              <p className="text-red-600 text-sm mt-2">{addStudentError}</p>
            )}
          </>
        }
      />

      {classroom.students.length === 0 ? (
        <div className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
            <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">尚無學生</p>
          <p className="text-xs text-gray-500">用上方「加學生」建立帳號或請學生輸入班級代碼</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {classroom.students.map((s) => (
            <div key={s.id} className="px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{s.name}</p>
                <p className="text-xs text-gray-500 hidden sm:block">{s.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 hidden sm:inline">{formatDate(s.enrolled_at)}</span>
                <ParentInviteButton token={token} studentId={s.id} studentName={s.name} />
                <ResetPasswordButton
                  token={token}
                  classroomId={classroom.id}
                  studentId={s.id}
                  studentName={s.name}
                />
                {removingStudentId === s.id ? (
                  <div className="flex gap-2">
                    <button onClick={() => onRemoveStudent(s)} className="text-xs text-red-600 font-medium hover:text-red-800 transition-colors cursor-pointer">確認移除</button>
                    <button onClick={() => setRemovingStudentId(null)} className="text-xs text-gray-500 hover:text-gray-700 transition-colors cursor-pointer">取消</button>
                  </div>
                ) : (
                  <button onClick={() => onRemoveStudent(s)} className="text-xs text-gray-400 hover:text-red-600 transition-colors cursor-pointer">移除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default StudentListTab;
