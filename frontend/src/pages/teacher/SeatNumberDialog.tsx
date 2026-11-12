/**
 * SeatNumberDialog — Junyi-parity "新增座號" batch dialog (#3992).
 *
 * Junyi's own SeatNumberDialog.jsx (legacy/studentlists-package) drag-reorders
 * students and prepends a "01 " style prefix straight into the nickname text
 * — there is no separate seat-number field over there at all. LingoLeap
 * already decided (#3826) to store the seat number in its OWN column
 * (`classroom_students.seat_number`) instead of mangling the student's
 * display name, so this dialog adapts the INTERACTION (see the whole roster,
 * reorder it, skip numbers for absent students, apply in one click) without
 * copying that data model.
 *
 * Two deliberate simplifications vs. the Junyi original, both judgment
 * calls to keep this proportionate to the feature (not over-engineered):
 *  - Up/down buttons instead of drag-and-drop — LingoLeap's frontend has no
 *    drag library dependency today and adding one just for this one dialog
 *    isn't worth the new dependency; the achievable outcome (reorder, then
 *    renumber) is identical.
 *  - Seat numbers are computed LIVE from the current row order (position in
 *    the list = seat number, placeholders still consume a number so real
 *    seats after them skip it) instead of requiring an explicit "按此排序
 *    新增座號" button first. There's no text to preview here (unlike
 *    Junyi, which is literally building nickname strings before you commit
 *    them), so a live preview removes a step without losing anything.
 *
 * Saving always submits the FULL roster-in-this-dialog's assignments via
 * the batch endpoint (#3992) in one request — never N sequential
 * single-row PATCH calls, which can transiently 409 when the new order
 * swaps/rotates seats that are already taken (see classroom_students.py's
 * set_student_seat_numbers_batch docstring).
 */
import React, { useEffect, useState } from 'react';
import { batchSetSeatNumbers, type StudentInClassroomResponse } from '../../services/classroomApi';

interface SeatRow {
  key: string;
  studentId: number | null; // null = an inserted empty/placeholder seat
  name: string;
}

interface SeatNumberDialogProps {
  isOpen: boolean;
  token: string;
  classroomId: number;
  students: StudentInClassroomResponse[];
  onClose: () => void;
  onSaved: () => void;
}

let placeholderCounter = 0;

const buildInitialRows = (students: StudentInClassroomResponse[]): SeatRow[] =>
  students.map((s) => ({ key: `s-${s.id}`, studentId: s.id, name: s.name }));

const SeatNumberDialog: React.FC<SeatNumberDialogProps> = ({
  isOpen,
  token,
  classroomId,
  students,
  onClose,
  onSaved,
}) => {
  const [rows, setRows] = useState<SeatRow[]>(() => buildInitialRows(students));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Re-seed from the latest roster every time the dialog opens (not on
  // every `students` change -- the roster re-fetches after other edits
  // too, e.g. renaming a student elsewhere, and that must not silently
  // discard reordering the teacher is mid-way through).
  useEffect(() => {
    if (isOpen) {
      setRows(buildInitialRows(students));
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const moveUp = (index: number) => {
    if (index === 0) return;
    setRows((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    setRows((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const insertEmptySeat = () => {
    placeholderCounter += 1;
    setRows((prev) => [
      ...prev,
      { key: `empty-${placeholderCounter}`, studentId: null, name: '空號' },
    ]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      const assignments = rows
        .map((row, i) => ({ row, seatNumber: i + 1 }))
        .filter((r) => r.row.studentId != null)
        .map((r) => ({ student_id: r.row.studentId as number, seat_number: r.seatNumber }));
      await batchSetSeatNumbers(token, classroomId, assignments);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '設定座號失敗，請再試一次');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="seat-dialog-title"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-auto">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 id="seat-dialog-title" className="text-xl font-bold text-gray-900">新增座號</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
        <p className="px-6 pt-1 text-sm text-gray-500">
          用上下箭頭排好順序，座號會依順序自動編；插入空號可以跳過請假或保留的號碼。
        </p>

        <div className="px-6 pt-3 pb-1">
          <button
            type="button"
            onClick={insertEmptySeat}
            className="h-9 px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            ＋ 插入空號
          </button>
        </div>

        <div className="px-6 max-h-[50vh] overflow-y-auto">
          <ul className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <li
                key={row.key}
                className={`flex items-center gap-3 py-2 ${row.studentId == null ? 'bg-gray-50' : ''}`}
              >
                <span className="w-8 text-center font-mono font-semibold text-gray-700 shrink-0">
                  {row.studentId != null ? i + 1 : ''}
                </span>
                <span className={`flex-1 min-w-0 truncate text-sm ${row.studentId == null ? 'text-gray-400 italic' : 'text-gray-900'}`}>
                  {row.name}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    aria-label={`${row.name} 上移`}
                    className="w-7 h-7 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(i)}
                    disabled={i === rows.length - 1}
                    aria-label={`${row.name} 下移`}
                    className="w-7 h-7 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    ↓
                  </button>
                  {row.studentId == null && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label="移除空號"
                      className="w-7 h-7 inline-flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="px-6 pt-2 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="h-10 px-5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="h-10 px-5 rounded-lg bg-[#19A696] hover:bg-[#15897B] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {isSaving ? '儲存中...' : '儲存座號'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeatNumberDialog;
