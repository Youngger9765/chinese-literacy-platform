/**
 * 作業分頁 (#3367)
 *
 * 合併原本分開的「作業管理」與「課文管理（指派課文）」：
 *   - 預設：班級作業總表（學生 × 老師出的全部作業）
 *   - 清單：正式作業（AssignmentTab）／自學課文庫（TextManagementTab）
 *   - 點作業名稱：該作業的逐大題全班統計 + 每位學生狀態
 *
 * 現場回饋「指派課文後只出現在這一頁、不會變成作業」——指派課文其實是放進
 * 學生的自學圖書館，教師端從沒講清楚，所以這裡明確標示「已在自學圖書館上架」。
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
import AssignmentMatrixGrid, { CellBadge } from './AssignmentMatrixGrid';

type ListFilter = 'all' | 'assignments' | 'library';

interface AssignmentsPanelProps {
  classroomId: number;
  selectedAssignmentId: number | null;
  onSelectAssignment: (id: number | null) => void;
}

const LIST_FILTERS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'assignments', label: '正式作業' },
  { key: 'library', label: '自學課文庫' },
];

function AssignmentDrilldown({
  matrix,
  assignmentId,
  onBack,
}: {
  matrix: AssignmentMatrixResponse;
  assignmentId: number;
  onBack: () => void;
}) {
  const { token } = useAuth();
  const [stats, setStats] = useState<AssignmentItemStatsResponse | null>(null);
  const [error, setError] = useState('');
  const assignment = matrix.assignments.find((a) => a.id === assignmentId);
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

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 cursor-pointer">
        ← 回班級作業總表
      </button>
      <div>
        <h3 className="text-xl font-bold text-gray-900">{assignment?.title ?? '作業'}</h3>
        <p className="text-gray-500 mt-1">{submitted} / {assigned} 人已交</p>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {stats ? <AssignmentItemStats data={stats} /> : !error && <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />}
      <div className="rounded-xl border border-gray-200">
        <h4 className="px-4 py-3 font-semibold text-gray-800 border-b border-gray-100">每位學生</h4>
        <ul>
          {matrix.students.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-b-0">
              <span className="text-gray-900">{s.name}</span>
              <CellBadge cell={cells.find((c) => c.student_id === s.id)} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const AssignmentsPanel: React.FC<AssignmentsPanelProps> = ({ classroomId, selectedAssignmentId, onSelectAssignment }) => {
  const { token } = useAuth();
  const [view, setView] = useState<'matrix' | 'list'>('matrix');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [matrix, setMatrix] = useState<AssignmentMatrixResponse | null>(null);
  const [error, setError] = useState('');

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
        <AssignmentDrilldown matrix={matrix} assignmentId={selectedAssignmentId} onBack={() => onSelectAssignment(null)} />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex gap-1 border-b border-gray-200" role="tablist" aria-label="作業檢視">
        {([['matrix', '班級作業總表'], ['list', '清單檢視']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`px-4 py-2.5 -mb-px border-b-2 font-medium cursor-pointer ${
              view === key ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'matrix' && (
        <>
          {error && <p className="text-red-600 text-sm">{error} <button className="underline" onClick={load}>重試</button></p>}
          {!matrix && !error && <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />}
          {matrix && <AssignmentMatrixGrid data={matrix} onOpenAssignment={onSelectAssignment} />}
          <p className="text-sm text-gray-500">只列老師指派的作業；學生自己選的練習在「學生學習紀錄」</p>
        </>
      )}

      {view === 'list' && (
        <>
          <div className="inline-flex rounded-lg bg-gray-100 p-1" role="group" aria-label="作業類型">
            {LIST_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium cursor-pointer ${
                  filter === f.key ? 'bg-white shadow text-accent' : 'text-gray-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {filter !== 'library' && (
            <section aria-label="正式作業">
              <h3 className="font-semibold text-gray-800 mb-2">正式作業</h3>
              <AssignmentTab classroomId={classroomId} />
            </section>
          )}
          {filter !== 'assignments' && (
            <section aria-label="自學課文庫">
              <h3 className="font-semibold text-gray-800">自學課文庫</h3>
              <p className="text-sm text-gray-600 mt-1 mb-2">
                <span className="inline-block w-2 h-2 rounded-full bg-accent mr-1.5 align-middle" />
                這裡的課文都已在學生的自學圖書館上架，學生可以自己選來練習；要計分、有期限、進總表，請建立正式作業
              </p>
              <TextManagementTab classroomId={classroomId} />
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default AssignmentsPanel;
