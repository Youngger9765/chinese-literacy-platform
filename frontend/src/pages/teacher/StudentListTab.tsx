import React, { useState } from 'react';
import type { BatchCreateResult, ClassroomDetailResponse, StudentInClassroomResponse } from '../../services/classroomApi';
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
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors cursor-pointer"
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
      <div className="flex flex-col items-start gap-0.5 text-sm">
        <span className="font-mono text-gray-700">帳號：{result.username}</span>
        <span className="font-mono text-gray-700">新密碼：{result.password}</span>
        <span className="text-gray-500">密碼只會顯示這一次，請抄下來</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={handleReset}
        disabled={isResetting}
        className="text-sm px-2.5 py-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {isResetting ? '重設中…' : '重設密碼'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
};

// Students created by the teacher get a synthetic e-mail; the part before "@"
// is the login name printed on the credential card, so show that, not the e-mail.
const accountName = (email: string) =>
  email.endsWith('@student.lingoleap.local') ? email.split('@')[0] : email;

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
  /** Junyi-parity: the add-students form lives in a modal opened by 新增學生. */
  isAddStudentsOpen: boolean;
  onCloseAddStudents: () => void;
  onOpenAddStudents: () => void;
  initialAddResult?: BatchCreateResult;
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
  isAddStudentsOpen,
  onCloseAddStudents,
  onOpenAddStudents,
  initialAddResult,
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

      {/* 加學生 —— 均一模式：先問「學生有沒有帳號」(#3378)；版面對齊均一後收進彈窗 */}
      {isAddStudentsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-students-title"
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-3 sm:p-6 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-auto">
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 id="add-students-title" className="text-xl font-bold text-gray-900">新增學生</h2>
              <button
                type="button"
                onClick={onCloseAddStudents}
                aria-label="關閉"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer"
              >
                ✕
              </button>
            </div>
      <AddStudentsPanel
        token={token}
        classroomId={classroom.id}
        classroomName={classroom.name}
        joinCode={classroom.join_code}
        nextSeat={classroom.students.length + 1}
        onCreated={onStudentsImported}
        onOpenCsv={() => setShowCsvModal(true)}
        initialResult={initialAddResult}
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

            <div className="flex justify-end px-6 pb-5">
              <button
                type="button"
                onClick={onCloseAddStudents}
                className="h-10 px-5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 cursor-pointer"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {classroom.students.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-base font-medium text-gray-700 mb-3">這個班級還沒有學生</p>
          <button
            type="button"
            onClick={onOpenAddStudents}
            className="h-11 px-6 rounded-lg bg-accent hover:bg-accent-hover text-white text-base font-medium cursor-pointer"
          >
            ＋ 新增學生
          </button>
        </div>
      ) : (
        <table className="w-full text-left">
          <thead className="hidden lg:table-header-group bg-gray-50 text-sm text-gray-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium w-16 text-center whitespace-nowrap">座號</th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">學生姓名</th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">帳號</th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">家長邀請碼</th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">重設密碼</th>
              <th scope="col" className="px-4 py-3 font-medium text-right whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {classroom.students.map((s, i) => (
              // #3424 kept: labels never break mid-word (whitespace-nowrap); on phones
              // each row stacks into a card instead of a squeezed table row.
              <tr key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 lg:table-row lg:p-0">
                <td className="hidden lg:table-cell px-4 py-3 text-center text-gray-500">{i + 1}</td>
                <td className="lg:px-4 lg:py-3 min-w-0 basis-full lg:basis-auto">
                  <p className="text-base font-medium text-gray-900">{s.name}</p>
                </td>
                <td className="lg:px-4 lg:py-3 text-sm text-gray-500 font-mono whitespace-nowrap">{accountName(s.email)}</td>
                <td className="lg:px-4 lg:py-3 whitespace-nowrap">
                  <ParentInviteButton token={token} studentId={s.id} studentName={s.name} />
                </td>
                <td className="lg:px-4 lg:py-3 whitespace-nowrap">
                  <ResetPasswordButton
                    token={token}
                    classroomId={classroom.id}
                    studentId={s.id}
                    studentName={s.name}
                  />
                </td>
                <td className="lg:px-4 lg:py-3 lg:text-right whitespace-nowrap ml-auto lg:ml-0">
                  <span className="sr-only">加入於 {formatDate(s.enrolled_at)}</span>
                  {removingStudentId === s.id ? (
                    <span className="inline-flex gap-2 whitespace-nowrap">
                      <button onClick={() => onRemoveStudent(s)} className="text-sm text-red-600 font-medium hover:text-red-800 transition-colors cursor-pointer whitespace-nowrap">確認移除</button>
                      <button onClick={() => setRemovingStudentId(null)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer whitespace-nowrap">取消</button>
                    </span>
                  ) : (
                    <button onClick={() => onRemoveStudent(s)} className="text-sm text-gray-400 hover:text-red-600 transition-colors cursor-pointer whitespace-nowrap px-1 py-1 -m-1">移除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};

export default StudentListTab;
