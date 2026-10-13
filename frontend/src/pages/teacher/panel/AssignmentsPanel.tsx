/**
 * 作業分頁 (#3367，#3376 簡化)
 *
 * 一張總表就好（Young 2026-10-10：介面請簡單）：
 *   - 班級作業總表：學生 × 老師出的作業。點作業名稱 → 逐大題全班統計；點學生 → 這位學生的作業
 *   - 下方收合：建立與管理作業（正式作業＋自學課文庫，原本分開的「作業管理」「課文管理」）
 *
 * 現場回饋「指派課文後只出現在這一頁、不會變成作業」——指派課文其實是放進
 * 學生的自學圖書館，所以這裡明確標示「已在自學圖書館上架」。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  AssignmentItemStatsResponse,
  AssignmentMatrixResponse,
  getAssignmentItemStats,
  getAssignmentMatrix,
} from '../../../services/teacherApi';
import AssignmentTab from '../AssignmentTab';
import TextManagementTab from '../TextManagementTab';
import AssignmentItemStats from './AssignmentItemStats';
import AssignmentMatrixGrid, { CellBadge, MatrixLegend, assignmentCounts, distinctTitles, isOverdue } from './AssignmentMatrixGrid';
import { StudentDetail } from './StudentsPanel';
import { assignmentCsv, downloadAssignmentCsv } from './assignmentCsv';

interface AssignmentsPanelProps {
  classroomId: number;
  selectedAssignmentId: number | null;
  onSelectAssignment: (id: number | null) => void;
  onOpenStudent: (studentId: number) => void;
}

function AssignmentDrilldown({
  classroomId,
  matrix,
  assignmentId,
  onBack,
}: {
  classroomId: number;
  matrix: AssignmentMatrixResponse;
  assignmentId: number;
  onBack: () => void;
}) {
  const { token } = useAuth();
  const [stats, setStats] = useState<AssignmentItemStatsResponse | null>(null);
  const [error, setError] = useState('');
  // Opening a student here keeps you inside this assignment (codex screen audit #6).
  const [studentId, setStudentId] = useState<number | null>(null);
  const assignment = matrix.assignments.find((a) => a.id === assignmentId);
  const title = distinctTitles(matrix.assignments).get(assignmentId) ?? '作業';
  const cells = matrix.cells.filter((c) => c.assignment_id === assignmentId);
  const submitted = cells.filter((c) => c.state === 'completed').length;
  const assigned = cells.filter((c) => c.state !== 'not_assigned').length;

  useEffect(() => {
    if (!token) return;
    setStats(null);
    setError('');
    getAssignmentItemStats(token, assignmentId)
      .then(setStats)
      .catch(() => setError('無法載入逐大題統計'));
  }, [token, assignmentId]);

  if (studentId !== null) {
    return (
      <StudentDetail
        classroomId={classroomId}
        studentId={studentId}
        onlyAssignmentId={assignmentId}
        backLabel={`← 回「${title}」`}
        onBack={() => setStudentId(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 cursor-pointer">
        ← 回班級作業總表
      </button>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-xl font-bold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={() =>
              downloadAssignmentCsv(
                `${title}.csv`,
                assignmentCsv(matrix, assignmentId, isOverdue(assignment?.due_date ?? null)),
              )
            }
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 cursor-pointer whitespace-nowrap"
          >
            下載這份作業成績（CSV）
          </button>
        </div>
        <p className="text-gray-500 mt-1">{submitted} / {assigned} 人已交</p>
        {(() => {
          const n = assignmentCounts(matrix.cells, assignmentId, isOverdue(assignment?.due_date ?? null));
          const chip = (label: string, value: number, cls: string) => (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${cls}`}>
              {label}<span className="text-lg font-bold">{value}</span>
            </span>
          );
          return (
            <div className="flex flex-wrap gap-2 mt-3" aria-label="各狀態人數">
              {chip('已交', n.submitted, 'bg-green-100 text-green-800')}
              {n.inProgress > 0 && chip('進行中', n.inProgress, 'border border-dashed border-amber-400 text-amber-700')}
              {n.notStarted > 0 && chip('未開始', n.notStarted, 'bg-gray-100 text-gray-600')}
              {n.overdue > 0 && chip('逾期未交', n.overdue, 'bg-red-100 text-red-700')}
            </div>
          );
        })()}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {stats ? <AssignmentItemStats data={stats} /> : !error && <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />}
      <div className="rounded-xl border border-gray-200">
        <h4 className="px-4 py-3 font-semibold text-gray-800 border-b border-gray-100">每位學生（點名字看他錯了哪些）</h4>
        <ul>
          {matrix.students.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-b-0">
              <button type="button" onClick={() => setStudentId(s.id)} className="text-gray-900 hover:text-accent hover:underline cursor-pointer">
                {s.name}
              </button>
              <CellBadge cell={cells.find((c) => c.student_id === s.id)} overdue={isOverdue(assignment?.due_date ?? null)} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const AssignmentsPanel: React.FC<AssignmentsPanelProps> = ({ classroomId, selectedAssignmentId, onSelectAssignment, onOpenStudent }) => {
  const { token } = useAuth();
  const [matrix, setMatrix] = useState<AssignmentMatrixResponse | null>(null);
  const [error, setError] = useState('');
  const [showManage, setShowManage] = useState(false);
  const [createSignal, setCreateSignal] = useState(0);

  const handleCreateClick = () => {
    setShowManage(true);
    setCreateSignal((s) => s + 1);
  };

  const load = useCallback(async () => {
    if (!token) return;
    setError('');
    try {
      setMatrix(await getAssignmentMatrix(token, classroomId));
    } catch {
      setError('無法載入班級作業總表');
    }
  }, [token, classroomId]);

  useEffect(() => {
    load();
  }, [load]);

  if (selectedAssignmentId !== null && matrix) {
    return (
      <div className="p-5">
        <AssignmentDrilldown
          classroomId={classroomId}
          matrix={matrix}
          assignmentId={selectedAssignmentId}
          onBack={() => onSelectAssignment(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      {/* Junyi-parity toolbar: 建立 / 管理 on the left, status legend on the right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCreateClick}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-accent hover:bg-accent-hover text-white text-base font-semibold transition-colors cursor-pointer"
          >
            建立作業
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setShowManage((v) => !v)}
            aria-expanded={showManage}
            className="inline-flex items-center h-11 px-5 rounded-lg border border-gray-300 text-gray-700 text-base font-medium hover:bg-gray-50 transition-colors cursor-pointer"
          >
            管理作業
          </button>
        </div>
        {matrix && matrix.assignments.length > 0 && (
          <MatrixLegend />
        )}
      </div>

      {showManage && (
        <section className="rounded-xl border border-gray-200" aria-label="建立與管理作業">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800 text-lg">建立與管理作業</h3>
            <button
              type="button"
              onClick={() => setShowManage(false)}
              className="text-sm text-gray-500 hover:text-gray-800 cursor-pointer"
            >
              收合 ▲
            </button>
          </div>
          <div className="p-4 space-y-6">
            <section aria-label="正式作業">
              <h3 className="font-semibold text-gray-800 mb-2">正式作業（會進下面的總表）</h3>
              <AssignmentTab classroomId={classroomId} onChanged={load} openSignal={createSignal} />
            </section>
            <section aria-label="自學課文庫">
              <h3 className="font-semibold text-gray-800">自學課文庫</h3>
              <p className="text-sm text-gray-600 mt-1 mb-2">
                這裡的課文都已在學生的自學圖書館上架，學生可以自己選來練習，不計分、不進總表
              </p>
              <TextManagementTab classroomId={classroomId} />
            </section>
          </div>
        </section>
      )}

      {error && <p className="text-red-600 text-sm">{error} <button className="underline" onClick={load}>重試</button></p>}
      {!matrix && !error && <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />}
      {matrix && <AssignmentMatrixGrid data={matrix} onOpenAssignment={onSelectAssignment} onOpenStudent={onOpenStudent} />}
    </div>
  );
};

export default AssignmentsPanel;
