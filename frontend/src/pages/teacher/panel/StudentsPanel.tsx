/**
 * 學生分頁 (#3376)
 *
 * 一張簡單的名單：每位學生交了幾份、平均幾分。點名字 → 這位學生每份作業的
 * 狀態、分數、三個部分、唸錯的字（老師回饋：「看不到他們究竟錯了哪些」）。
 * 刻意只放老師每天會看的東西；完整學習曲線、標籤、指導紀錄在「更多 → 詳細學習紀錄」。
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  AssignmentMatrixResponse,
  StudentAssignmentsResponse,
  getAssignmentMatrix,
  getStudentAssignments,
} from '../../../services/teacherApi';
import { CellBadge, distinctTitles, isOverdue } from './AssignmentMatrixGrid';

interface StudentsPanelProps {
  classroomId: number;
  selectedStudentId: number | null;
  onSelectStudent: (id: number | null) => void;
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}`);

export function StudentDetail({
  classroomId,
  studentId,
  onBack,
  onlyAssignmentId,
  backLabel = '← 回學生名單',
}: {
  classroomId: number;
  studentId: number;
  onBack: () => void;
  /** Opened from one assignment: show only that one (codex screen audit #6). */
  onlyAssignmentId?: number;
  backLabel?: string;
}) {
  const { token } = useAuth();
  const [data, setData] = useState<StudentAssignmentsResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setData(null);
    setError('');
    getStudentAssignments(token, classroomId, studentId)
      .then(setData)
      .catch(() => setError('無法載入這位學生的作業'));
  }, [token, classroomId, studentId]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 cursor-pointer">
        {backLabel}
      </button>
      {error && <p className="text-red-600">{error}</p>}
      {!data && !error && <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />}
      {data && (() => {
        const titles = distinctTitles(data.rows.map((r) => ({ id: r.assignment_id, title: r.title })));
        const rows = (onlyAssignmentId ? data.rows.filter((r) => r.assignment_id === onlyAssignmentId) : data.rows)
          .map((r) => ({ ...r, title: titles.get(r.assignment_id) ?? r.title }));
        // Every part empty for every row: one sentence instead of columns of dashes (codex screen audit #1).
        const noParts = rows.every((r) => r.reading_accuracy === null && r.comprehension === null && r.vocab === null && r.error_chars.length === 0);
        return (
        <>
          <h3 className="text-xl font-bold text-gray-900">{data.student_name}</h3>
          {rows.length === 0 ? (
            <p className="text-gray-500">這個班級還沒有指派作業</p>
          ) : (
            <>
            <ul className="sm:hidden space-y-3" aria-label="這位學生的作業（手機）">
              {rows.map((r) => (
                <li key={r.assignment_id} className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-900">{r.title}</span>
                    <CellBadge cell={{ student_id: studentId, assignment_id: r.assignment_id, state: r.state, score: r.score, current_step: r.current_step }} overdue={isOverdue(r.due_date)} />
                  </div>
                  {!noParts && <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div><div className="text-gray-500">朗讀</div><div className="font-semibold tabular-nums">{pct(r.reading_accuracy)}</div></div>
                    <div><div className="text-gray-500">理解</div><div className="font-semibold tabular-nums">{pct(r.comprehension)}</div></div>
                    <div><div className="text-gray-500">生字</div><div className="font-semibold tabular-nums">{pct(r.vocab)}</div></div>
                  </div>}
                  {r.error_chars.length > 0 && (
                    <p className="text-sm"><span className="text-gray-500">唸錯的字 </span><span className="text-red-700 tracking-widest">{r.error_chars.join('')}</span></p>
                  )}
                </li>
              ))}
            </ul>
            <table className="hidden sm:table w-full text-left" aria-label="這位學生的作業">
              <thead>
                <tr className="text-sm text-gray-500 border-b border-gray-200">
                  <th className="py-2 font-medium">作業</th>
                  <th className="py-2 font-medium">狀態</th>
                  {!noParts && <th className="py-2 font-medium text-right">朗讀</th>}
                  {!noParts && <th className="py-2 font-medium text-right">理解</th>}
                  {!noParts && <th className="py-2 font-medium text-right">生字</th>}
                  {!noParts && <th className="py-2 font-medium pl-4">唸錯的字</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assignment_id} className="border-b border-gray-100 align-top">
                    <td className="py-3 font-medium text-gray-900">{r.title}</td>
                    <td className="py-3">
                      <CellBadge cell={{ student_id: studentId, assignment_id: r.assignment_id, state: r.state, score: r.score, current_step: r.current_step }} overdue={isOverdue(r.due_date)} />
                    </td>
                    {!noParts && <>
                    <td className="py-3 text-right tabular-nums">{pct(r.reading_accuracy)}</td>
                    <td className="py-3 text-right tabular-nums">{pct(r.comprehension)}</td>
                    <td className="py-3 text-right tabular-nums">{pct(r.vocab)}</td>
                    <td className="py-3 pl-4">
                      {r.error_chars.length > 0 ? (
                        <span className="text-red-700 tracking-widest">{r.error_chars.join('')}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
          {noParts ? (
            <p className="text-sm text-gray-600">這些作業沒有記錄到朗讀、理解、生字的分項成績，只看得到交了沒有</p>
          ) : (
            <p className="text-sm text-gray-500">「—」代表這份作業沒有記錄到那一部分</p>
          )}
        </>
        );
      })()}
    </div>
  );
}

/** Per-student summary from the class matrix: submitted count and average score. */
export function summarizeStudents(matrix: AssignmentMatrixResponse) {
  return matrix.students.map((s) => {
    const cells = matrix.cells.filter((c) => c.student_id === s.id && c.state !== 'not_assigned');
    const done = cells.filter((c) => c.state === 'completed');
    const scores = done.map((c) => c.score).filter((v): v is number => v !== null);
    return {
      id: s.id,
      name: s.name,
      submitted: done.length,
      assigned: cells.length,
      average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });
}

const StudentsPanel: React.FC<StudentsPanelProps> = ({ classroomId, selectedStudentId, onSelectStudent }) => {
  const { token } = useAuth();
  const [matrix, setMatrix] = useState<AssignmentMatrixResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    getAssignmentMatrix(token, classroomId)
      .then(setMatrix)
      .catch(() => setError('無法載入學生名單'));
  }, [token, classroomId]);

  if (selectedStudentId !== null) {
    return (
      <div className="p-5">
        <StudentDetail classroomId={classroomId} studentId={selectedStudentId} onBack={() => onSelectStudent(null)} />
      </div>
    );
  }

  return (
    <div className="p-5">
      {error && <p className="text-red-600">{error}</p>}
      {!matrix && !error && <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />}
      {matrix && (
        <table className="w-full text-left" aria-label="學生名單">
          <thead>
            <tr className="text-sm text-gray-500 border-b border-gray-200">
              <th className="py-2 font-medium">學生</th>
              <th className="py-2 font-medium">已交作業</th>
              <th className="py-2 font-medium">平均分數</th>
            </tr>
          </thead>
          <tbody>
            {summarizeStudents(matrix).map((s) => (
              <tr key={s.id} className="border-b border-gray-100">
                <td className="py-3">
                  <button type="button" onClick={() => onSelectStudent(s.id)} className="font-semibold text-accent hover:underline cursor-pointer">
                    {s.name}
                  </button>
                </td>
                <td className="py-3 tabular-nums">{s.submitted} / {s.assigned}</td>
                <td className="py-3 tabular-nums">{s.average ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default StudentsPanel;
