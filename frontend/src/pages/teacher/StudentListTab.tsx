import React, { useEffect, useState } from 'react';
import type { BatchCreateResult, ClassroomDetailResponse, ClassroomResponse, StudentInClassroomResponse } from '../../services/classroomApi';
import CsvUploadModal from './CsvUploadModal';
import AddStudentsPanel from './panel/AddStudentsPanel';
import { batchRemoveStudents, listMyClassrooms, moveStudent, renameStudent, resetStudentPassword, setStudentSeatNumber } from '../../services/classroomApi';
import {
  generateParentInviteCode,
  listStudentParentLinks,
  revokeStudentParentLink,
  type StudentParentLink,
} from '../../services/parentApi';
import * as featureFlags from '../../config/featureFlags';

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

// ── Per-student linked parents (#3517) ───────────────────────────────────────

export const LinkedParentsButton: React.FC<{ token: string; studentId: number; studentName: string }> = ({
  token,
  studentId,
  studentName,
}) => {
  const [links, setLinks] = useState<StudentParentLink[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError('');
    try {
      setLinks(await listStudentParentLinks(token, studentId));
    } catch {
      setError('讀取失敗');
    }
  };

  const revoke = async (link: StudentParentLink) => {
    if (!window.confirm(`確定取消 ${link.parent_name || link.parent_email} 與 ${studentName} 的連結？取消後對方就看不到孩子的學習資料。`)) return;
    try {
      await revokeStudentParentLink(token, studentId, link.link_id);
      setLinks((prev) => (prev ?? []).filter((l) => l.link_id !== link.link_id));
    } catch {
      setError('取消失敗，請再試一次');
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer whitespace-nowrap"
      >
        已連結家長
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm whitespace-normal">
          {error && <p className="text-red-600">{error}</p>}
          {links === null && !error && <p className="text-gray-500">讀取中…</p>}
          {links !== null && links.length === 0 && <p className="text-gray-500">還沒有家長連結</p>}
          {links !== null && links.length > 0 && (
            <ul className="space-y-2" aria-label={`${studentName} 的家長`}>
              {links.map((l) => (
                <li key={l.link_id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900 truncate">{l.parent_name || '家長'}</span>
                    <span className="block text-xs text-gray-500 truncate">{l.parent_email}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(l)}
                    className="shrink-0 text-xs text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    取消連結
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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

// ── Per-student "move to another of my classrooms" button (#3819) ───────────
//
//換班 = remove-from-here + add-to-there in one backend call, so the student
// is never visibly deleted mid-flight. The candidate list is lazily fetched
// (only when the teacher opens the picker) and scoped to classrooms in the
// SAME school, excluding the current one -- matching the backend's own
// same-school guard, so a choice that would 400 never even appears.
const MoveStudentButton: React.FC<{
  token: string;
  classroom: ClassroomDetailResponse;
  studentId: number;
  studentName: string;
  onMoved: () => void;
}> = ({ token, classroom, studentId, studentName, onMoved }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [candidates, setCandidates] = useState<ClassroomResponse[] | null>(null);
  const [targetId, setTargetId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    setIsOpen(true);
    setError('');
    if (candidates !== null) return;
    setIsLoading(true);
    try {
      const result = await listMyClassrooms(token, { limit: 100 });
      setCandidates(
        result.items.filter((c) => c.school_id === classroom.school_id && c.id !== classroom.id),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '讀取班級清單失敗');
      setCandidates([]);
    } finally {
      setIsLoading(false);
    }
  };

  const close = () => {
    setIsOpen(false);
    setTargetId('');
    setError('');
  };

  const handleMove = async () => {
    if (!targetId) return;
    const target = candidates?.find((c) => String(c.id) === targetId);
    if (!target) return;
    if (!window.confirm(`確定把「${studentName}」從目前班級換到「${target.name}」嗎？`)) return;
    setIsMoving(true);
    setError('');
    try {
      await moveStudent(token, classroom.id, studentId, target.id);
      close();
      onMoved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '換班失敗，請再試一次');
    } finally {
      setIsMoving(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={open}
        className="text-sm text-gray-400 hover:text-indigo-600 transition-colors cursor-pointer whitespace-nowrap px-1 py-1 -m-1"
      >
        換班
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1 text-sm">
      {isLoading && <span className="text-gray-500">讀取班級中…</span>}
      {!isLoading && candidates !== null && candidates.length === 0 && (
        <span className="text-gray-500">沒有其他可換入的班級</span>
      )}
      {!isLoading && candidates !== null && candidates.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            aria-label={`把 ${studentName} 換到哪個班級`}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="h-8 px-2 rounded-md border border-gray-300 text-sm"
          >
            <option value="">選擇班級…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleMove}
            disabled={!targetId || isMoving}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {isMoving ? '換班中…' : '確認換班'}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={close}
        className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
      >
        取消
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
};

// ── Batch-remove action bar (#3821) ──────────────────────────────────────────
//
// Fixed bar at the bottom of the screen that only appears once at least one
// student is checked -- a confirm dialog states the count (AC2: the teacher
// must see "N 位學生" before anything is sent), and only removes the ones
// selected from THIS classroom. It never touches the account itself.
const BatchActionBar: React.FC<{
  selectedCount: number;
  isRemoving: boolean;
  onCancel: () => void;
  onBatchRemove: () => void;
}> = ({ selectedCount, isRemoving, onCancel, onBatchRemove }) => {
  if (selectedCount === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-gray-900 text-white px-6 py-3 flex items-center justify-between shadow-lg">
      <div className="text-sm">
        已選取 <span className="font-semibold">{selectedCount}</span> 位學生
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isRemoving}
          className="text-sm px-3 py-1.5 rounded-md border border-gray-600 hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onBatchRemove}
          disabled={isRemoving}
          className="text-sm px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer font-medium"
        >
          {isRemoving ? '移除中…' : '移除學生'}
        </button>
      </div>
    </div>
  );
};

// ── Inline-edit display name (#3826) ─────────────────────────────────────────
//
// Pencil-icon style (均一 StudentRow.jsx concept, not its code): click the
// pencil -> autofocused input -> Enter confirms (PATCH), Escape cancels. This
// edits User.name, the SAME field shown everywhere on the platform -- it is
// NOT the login username/email, which stays untouched.
const EditableNameCell: React.FC<{
  token: string;
  classroomId: number;
  studentId: number;
  name: string;
  onRenamed: () => void;
}> = ({ token, classroomId, studentId, name, onRenamed }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft(name);
    setError('');
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setDraft(name);
    setError('');
  };

  const confirm = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await renameStudent(token, classroomId, studentId, trimmed);
      setIsEditing(false);
      onRenamed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '改名失敗，請再試一次');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="flex items-center gap-1.5">
        <p className="text-base font-medium text-gray-900">{name}</p>
        <button
          type="button"
          onClick={startEdit}
          aria-label={`編輯 ${name} 的顯示名稱`}
          className="text-gray-300 hover:text-indigo-600 transition-colors cursor-pointer text-xs"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        value={draft}
        aria-label={`${name} 顯示名稱輸入框`}
        autoFocus
        disabled={isSaving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm();
          if (e.key === 'Escape') cancel();
        }}
        className="h-8 px-2 rounded-md border border-indigo-300 text-sm w-32"
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
};

// ── Inline-edit seat number (#3826) ──────────────────────────────────────────
//
// Scoped to THIS classroom's enrollment row -- NOT the string baked into the
// login username at account-creation time. null clears it, falling back to
// the row's array index (same display as every pre-#3826 row).
const EditableSeatCell: React.FC<{
  token: string;
  classroomId: number;
  studentId: number;
  studentName: string;
  seatNumber: number | null | undefined;
  rowIndex: number;
  onSeatChanged: () => void;
}> = ({ token, classroomId, studentId, studentName, seatNumber, rowIndex, onSeatChanged }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(seatNumber != null ? String(seatNumber) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft(seatNumber != null ? String(seatNumber) : '');
    setError('');
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setDraft(seatNumber != null ? String(seatNumber) : '');
    setError('');
  };

  const confirm = async () => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 1)) {
      setError('座號必須是正整數');
      return;
    }
    if (next === (seatNumber ?? null)) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await setStudentSeatNumber(token, classroomId, studentId, next);
      setIsEditing(false);
      onSeatChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '設定座號失敗，請再試一次');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="flex items-center justify-center gap-1">
        <span>{seatNumber ?? rowIndex + 1}</span>
        <button
          type="button"
          onClick={startEdit}
          aria-label={`編輯 ${studentName} 的座號`}
          className="text-gray-300 hover:text-indigo-600 transition-colors cursor-pointer text-xs"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="number"
        value={draft}
        aria-label={`${studentName} 座號輸入框`}
        autoFocus
        disabled={isSaving}
        min={1}
        max={999}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm();
          if (e.key === 'Escape') cancel();
        }}
        className="h-8 w-16 px-2 rounded-md border border-indigo-300 text-sm text-center"
      />
      {error && <span className="text-xs text-red-500 whitespace-normal max-w-[8rem]">{error}</span>}
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
  // Parent portal is off unless VITE_PARENT_PORTAL_ENABLED=true; a code a parent
  // cannot enter anywhere is a dead end, so the teacher half follows the flag.
  const showParentInvite = featureFlags.PARENT_PORTAL_ENABLED;

  // ── Batch-remove selection state (#3821) ──────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBatchRemoving, setIsBatchRemoving] = useState(false);
  const [batchRemoveError, setBatchRemoveError] = useState('');

  const toggleSelected = (studentId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBatchRemoveError('');
  };

  // If the parent reuses this component instance across a classroom switch
  // (no remount), stale checked ids from the PREVIOUS classroom must not
  // silently carry over into a batch-remove call against the new one.
  useEffect(() => {
    clearSelection();
  }, [classroom.id]);

  const handleBatchRemove = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(`確定要移除 ${count} 位學生嗎？`)) return;
    setIsBatchRemoving(true);
    setBatchRemoveError('');
    try {
      await batchRemoveStudents(token, classroom.id, Array.from(selectedIds));
      clearSelection();
      onStudentsImported();
    } catch (err: unknown) {
      setBatchRemoveError(err instanceof Error ? err.message : '批次移除失敗，請再試一次');
    } finally {
      setIsBatchRemoving(false);
    }
  };

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
        existingNames={classroom.students.map((s) => s.name)}
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
        // Issue #3985: on desktop (lg:table-row, a real table — not the
        // mobile flex-wrap cards below) the 6 columns (座號/學生姓名/帳號/
        // 家長邀請碼/重設密碼/操作) can need more width than this section has
        // once the persistent ClassListSidebar (#3401) takes ~208px at the
        // xl breakpoint — confirmed on staging at 1280px, where 操作 (換班/
        // 移除) rendered past the table's right edge and the ancestor
        // `overflow-hidden` "學生名單" section clipped it, same failure mode
        // as the mobile bug above, different width. `overflow-x-auto` here
        // gives the table a horizontal scrollbar on its own axis instead of
        // silently losing a column — the table never needed this section's
        // own `overflow-hidden` (that's there to clip the border-radius).
        <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="hidden lg:table-header-group bg-gray-50 text-sm text-gray-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium w-10 text-center whitespace-nowrap">
                <input
                  type="checkbox"
                  aria-label="全選"
                  checked={selectedIds.size > 0 && selectedIds.size === classroom.students.length}
                  onChange={(e) =>
                    setSelectedIds(e.target.checked ? new Set(classroom.students.map((s) => s.id)) : new Set())
                  }
                />
              </th>
              <th scope="col" className="px-4 py-3 font-medium w-16 text-center whitespace-nowrap">座號</th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">學生姓名</th>
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">帳號</th>
              {showParentInvite && (
                <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">家長邀請碼</th>
              )}
              <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">重設密碼</th>
              <th scope="col" className="px-4 py-3 font-medium text-right whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {classroom.students.map((s, i) => (
              // #3424 kept: labels never break mid-word (whitespace-nowrap); on phones
              // each row stacks into a card instead of a squeezed table row.
              <tr key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 lg:table-row lg:p-0">
                <td className="lg:px-4 lg:py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label={`選取 ${s.name}`}
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggleSelected(s.id)}
                  />
                </td>
                                <td className="hidden lg:table-cell px-4 py-3 text-center text-gray-500">
                  <EditableSeatCell
                    token={token}
                    classroomId={classroom.id}
                    studentId={s.id}
                    studentName={s.name}
                    seatNumber={s.seat_number}
                    rowIndex={i}
                    onSeatChanged={onStudentsImported}
                  />
                </td>
                <td className="lg:px-4 lg:py-3 min-w-0 basis-full lg:basis-auto">
                  <EditableNameCell
                    token={token}
                    classroomId={classroom.id}
                    studentId={s.id}
                    name={s.name}
                    onRenamed={onStudentsImported}
                  />
                </td>
                <td className="lg:px-4 lg:py-3 text-sm text-gray-500 font-mono whitespace-nowrap">{accountName(s.email)}</td>
                {showParentInvite && (
                  <td className="lg:px-4 lg:py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <ParentInviteButton token={token} studentId={s.id} studentName={s.name} />
                      <LinkedParentsButton token={token} studentId={s.id} studentName={s.name} />
                    </div>
                  </td>
                )}
                <td className="lg:px-4 lg:py-3 whitespace-nowrap">
                  {/* #3818: only the account's password teacher (the teacher
                      who created it) sees the reset button -- a self-registered
                      account nobody is recorded as having created shows the
                      self-serve hint instead. */}
                  {s.can_reset_password ? (
                    <ResetPasswordButton
                      token={token}
                      classroomId={classroom.id}
                      studentId={s.id}
                      studentName={s.name}
                    />
                  ) : (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      請學生自己用忘記密碼重設
                    </span>
                  )}
                </td>
                {/* Issue #3985: this used to be `whitespace-nowrap ml-auto lg:ml-0` —
                    on a 390px phone, `ml-auto` anchors the cell to the right edge of
                    whatever space is left on its flex-wrap line, and `whitespace-nowrap`
                    stops its own content from wrapping. When the remaining space on
                    that line was narrower than "換班 移除" together, the cell rendered
                    partly past the row's right edge, and the ancestor `overflow-hidden`
                    section (ClassroomDetail's 學生名單 wrapper) clipped it — reachable
                    nowhere on a phone. `basis-full` guarantees this cell always gets
                    its own full-width line on mobile, the same pattern the name cell
                    (above) already uses, so there's no line to share and nothing to
                    clip. Desktop (`lg:`) is unchanged. */}
                <td className="basis-full lg:basis-auto mt-1 lg:mt-0 lg:px-4 lg:py-3 lg:text-right lg:whitespace-nowrap lg:ml-0">
                  <span className="sr-only">加入於 {formatDate(s.enrolled_at)}</span>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <MoveStudentButton
                      token={token}
                      classroom={classroom}
                      studentId={s.id}
                      studentName={s.name}
                      onMoved={onStudentsImported}
                    />
                    {removingStudentId === s.id ? (
                      <span className="inline-flex gap-2 whitespace-nowrap">
                        <button onClick={() => onRemoveStudent(s)} className="text-sm text-red-600 font-medium hover:text-red-800 transition-colors cursor-pointer whitespace-nowrap">確認移除</button>
                        <button onClick={() => setRemovingStudentId(null)} className="text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer whitespace-nowrap">取消</button>
                      </span>
                    ) : (
                      <button onClick={() => onRemoveStudent(s)} className="text-sm text-gray-400 hover:text-red-600 transition-colors cursor-pointer whitespace-nowrap px-1 py-1 -m-1">移除</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {batchRemoveError && (
        <p className="text-red-600 text-sm px-4 py-2">{batchRemoveError}</p>
      )}
      <BatchActionBar
        selectedCount={selectedIds.size}
        isRemoving={isBatchRemoving}
        onCancel={clearSelection}
        onBatchRemove={handleBatchRemove}
      />
    </>
  );
};

export default StudentListTab;
