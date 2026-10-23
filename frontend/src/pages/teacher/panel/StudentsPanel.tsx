/**
 * 學生分頁 (#3376)
 *
 * 一張簡單的名單：每位學生交了幾份、平均幾分。點名字 → 這位學生每份作業的
 * 狀態、分數、三個部分、唸錯的字（老師回饋：「看不到他們究竟錯了哪些」）。
 * 刻意只放老師每天會看的東西；完整學習曲線、標籤、指導紀錄在「更多 → 詳細學習紀錄」。
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import {
  AssignmentMatrixResponse,
  StudentAssignmentsResponse,
  StudentSession,
  getAssignmentMatrix,
  getStudentAssignments,
  getStudentSessions,
} from '../../../services/teacherApi';
import { CellBadge, distinctTitles, isOverdue } from './AssignmentMatrixGrid';

/**
 * Issue #3682: a student stuck mid-lesson (state in_progress / pending) has
 * nothing in 朗讀/理解/生字 yet, so without this link their row was a dead
 * end — "進行中" and nothing else. Whenever session_id is present (set as
 * soon as the student starts, regardless of status) this links to the one
 * page that already renders what they've answered step by step.
 */
function AnswerRecordLink({ studentId, sessionId }: { studentId: number; sessionId: number | null }) {
  if (sessionId === null) return null;
  return (
    <Link
      to={`/teacher/students/${studentId}/sessions/${sessionId}/report`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors whitespace-nowrap"
      title="查看這位學生目前答過的內容"
    >
      作答紀錄
    </Link>
  );
}

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

  // Self-practice sessions (not linked to any assignment) — matrix/assignment
  // screens have no path to this data at all otherwise. Fetched separately
  // from `data` (assignment rows) since it's a different endpoint/shape; the
  // dedup against assignment-linked session ids happens below, once both are
  // loaded.
  const [sessions, setSessions] = useState<StudentSession[] | null>(null);

  useEffect(() => {
    if (!token) return;
    setSessions(null);
    getStudentSessions(token, studentId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [token, studentId]);

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
        // Self-practice = a session NOT already linked to one of this
        // student's assignment rows. Hidden when viewing a single assignment
        // (onlyAssignmentId) since that's a narrower, assignment-only context.
        const assignmentSessionIds = new Set(
          data.rows.map((r) => r.session_id).filter((id): id is number => id !== null),
        );
        const selfPracticeSessions = !onlyAssignmentId
          ? (sessions ?? []).filter((s) => !assignmentSessionIds.has(s.id))
          : [];
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <CellBadge cell={{ student_id: studentId, assignment_id: r.assignment_id, state: r.state, score: r.score, current_step: r.current_step }} overdue={isOverdue(r.due_date)} />
                      <AnswerRecordLink studentId={studentId} sessionId={r.session_id} />
                    </div>
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
                  <th className="py-2 font-medium pl-4">作答紀錄</th>
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
                    <td className="py-3 pl-4">
                      <AnswerRecordLink studentId={studentId} sessionId={r.session_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
          {noParts ? (
            <p className="text-sm text-gray-600">
              這些作業沒有記錄到朗讀、理解、生字的分項成績——點「作答紀錄」看他目前做到哪裡、答了什麼
            </p>
          ) : (
            <p className="text-sm text-gray-500">「—」代表這份作業沒有記錄到那一部分</p>
          )}
          {selfPracticeSessions.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-base font-semibold text-gray-900">自主練習</h4>
              <ul className="space-y-2" aria-label="自主練習紀錄">
                {selfPracticeSessions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{s.story_title ?? '（未知課文）'}</p>
                      <p className="text-xs text-gray-500">
                        {s.status === 'completed'
                          ? `已完成${s.overall_score !== null ? ` · ${Math.round(s.overall_score)} 分` : ''}`
                          : '進行中'}
                      </p>
                    </div>
                    <Link
                      to={`/teacher/students/${studentId}/sessions/${s.id}/report`}
                      className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded text-xs font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors"
                    >
                      查看報告
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
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
      {matrix && (() => {
        const students = summarizeStudents(matrix);
        return (
          <>
            <ul className="sm:hidden space-y-3" aria-label="學生名單（手機）">
              {students.map((s) => (
                <li key={s.id} className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <button type="button" onClick={() => onSelectStudent(s.id)} className="font-semibold text-accent hover:underline cursor-pointer">
                    {s.name}
                  </button>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><div className="text-gray-500">已交作業 </div><div className="font-semibold tabular-nums">{s.submitted} / {s.assigned}</div></div>
                    <div><div className="text-gray-500">平均分數 </div><div className="font-semibold tabular-nums">{s.average ?? '—'}</div></div>
                  </div>
                </li>
              ))}
            </ul>
            <table className="hidden sm:table w-full text-left" aria-label="學生名單">
              <thead>
                <tr className="text-sm text-gray-500 border-b border-gray-200">
                  <th className="py-2 font-medium">學生</th>
                  <th className="py-2 font-medium">已交作業</th>
                  <th className="py-2 font-medium">平均分數</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
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
          </>
        );
      })()}
    </div>
  );
};

export default StudentsPanel;
