/**
 * 今日總覽 (#3367)
 *
 * 老師進到班級第一眼要回答的三件事：誰還沒交、誰需要我介入、現在誰在線上。
 * 課堂即時不再是獨立分頁，收成這裡的一張卡片，點開才顯示完整畫面。
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  AssignmentMatrixResponse,
  AtRiskStudent,
  LiveMonitorResponse,
  getAssignmentMatrix,
  getAtRiskStudents,
  getClassroomLiveMonitor,
} from '../../../services/teacherApi';
import LiveMonitorTab from '../LiveMonitorTab';

interface TodayOverviewTabProps {
  classroomId: number;
  onOpenAssignment: (assignmentId: number) => void;
  onOpenAtRisk: () => void;
}

/** A student counts as "online" when their last tracked activity is within this window. */
const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export interface AssignmentProgressRow {
  id: number;
  title: string;
  dueDate: string | null;
  submitted: number;
  assigned: number;
  /** overdue | today | upcoming | none */
  dueState: 'overdue' | 'today' | 'upcoming' | 'none';
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Overdue / due-today first, then by due date; assignments without a due date last. */
export function buildAssignmentProgress(matrix: AssignmentMatrixResponse, now: Date): AssignmentProgressRow[] {
  const rows = matrix.assignments.map((a) => {
    const cells = matrix.cells.filter((c) => c.assignment_id === a.id);
    let dueState: AssignmentProgressRow['dueState'] = 'none';
    if (a.due_date) {
      const due = new Date(a.due_date);
      if (dayKey(due) === dayKey(now)) dueState = 'today';
      else dueState = due < now ? 'overdue' : 'upcoming';
    }
    return {
      id: a.id,
      title: a.title,
      dueDate: a.due_date,
      submitted: cells.filter((c) => c.state === 'completed').length,
      assigned: cells.filter((c) => c.state !== 'not_assigned').length,
      dueState,
    };
  });
  const rank = { overdue: 0, today: 1, upcoming: 2, none: 3 } as const;
  return rows.sort((x, y) =>
    rank[x.dueState] - rank[y.dueState]
    || (x.dueDate && y.dueDate ? x.dueDate.localeCompare(y.dueDate) : 0));
}

/** Students still owing work on an assignment that is overdue or due today. */
export function countPending(rows: AssignmentProgressRow[]): number {
  return rows
    .filter((r) => r.dueState === 'overdue' || r.dueState === 'today')
    .reduce((n, r) => n + (r.assigned - r.submitted), 0);
}

const DUE_LABEL: Record<AssignmentProgressRow['dueState'], string> = {
  overdue: '已逾期',
  today: '今天到期',
  upcoming: '',
  none: '無期限',
};

function formatDue(row: AssignmentProgressRow): string {
  const date = row.dueDate
    ? new Date(row.dueDate).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
    : '';
  const label = DUE_LABEL[row.dueState];
  return [date, label && `（${label}）`].filter(Boolean).join('');
}

function SummaryCard({ value, label, tone, onClick }: { value: string; label: string; tone: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left rounded-2xl border bg-white p-4 sm:p-5 border-l-4 ${tone} ${onClick ? 'hover:shadow-card cursor-pointer' : ''}`}
    >
      <div className="text-2xl sm:text-3xl font-bold text-gray-900">{value}</div>
      <div className="text-gray-600 mt-1">{label}</div>
    </Tag>
  );
}

const TodayOverviewTab: React.FC<TodayOverviewTabProps> = ({ classroomId, onOpenAssignment, onOpenAtRisk }) => {
  const { token } = useAuth();
  const [matrix, setMatrix] = useState<AssignmentMatrixResponse | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskStudent[] | null>(null);
  const [live, setLive] = useState<LiveMonitorResponse | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [atRiskFailed, setAtRiskFailed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setError('');
    // Each card loads on its own: one slow or failing source must not blank the page.
    getAssignmentMatrix(token, classroomId)
      .then((d) => !cancelled && setMatrix(d))
      .catch(() => !cancelled && setError('無法載入作業進度'));
    getAtRiskStudents(token, classroomId)
      .then((d) => !cancelled && setAtRisk(d))
      // A failed load must not read as "0 students need attention".
      .catch(() => !cancelled && setAtRiskFailed(true));
    getClassroomLiveMonitor(token, classroomId)
      .then((d) => !cancelled && setLive(d))
      .catch(() => !cancelled && setLive(null));
    return () => {
      cancelled = true;
    };
  }, [token, classroomId]);

  const now = new Date();
  const rows = matrix ? buildAssignmentProgress(matrix, now) : [];
  const pending = matrix ? countPending(rows) : null;
  const dueToday = rows.find((r) => r.dueState === 'today');
  const needsAttention = atRisk?.filter((s) => s.risk_level === 'high' || s.risk_level === 'medium').length ?? null;
  const onlineCount = live
    ? live.students.filter((s) => s.last_activity_at && now.getTime() - new Date(s.last_activity_at).getTime() < ONLINE_WINDOW_MS).length
    : null;

  return (
    <div className="p-5 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          value={pending === null ? '…' : `${pending} 份`}
          label={dueToday ? `待交作業・「${dueToday.title}」今天到期` : '待交作業（逾期與今天到期）'}
          tone="border-l-accent"
        />
        <SummaryCard
          value={atRiskFailed ? '—' : needsAttention === null ? '…' : `${needsAttention} 位`}
          label="需要關注的學生（早期介入中/高風險）"
          tone="border-l-amber-500"
          onClick={onOpenAtRisk}
        />
        <SummaryCard
          value={onlineCount === null ? '—' : `${onlineCount} 位在線`}
          label={showLive ? '課堂即時・點這裡收合' : '課堂即時・點開看詳情'}
          tone="border-l-gray-400"
          onClick={() => setShowLive((v) => !v)}
        />
      </div>

      {showLive && (
        <div className="rounded-2xl border border-gray-200">
          <LiveMonitorTab classroomId={classroomId} />
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-lg font-bold text-gray-900">作業進度</h3>
        <p className="text-gray-500 text-sm mt-0.5 mb-4">依到期日排序，逾期與今天到期排最前面</p>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {!matrix && !error && <div className="h-32 rounded-xl bg-gray-100 animate-pulse" />}
        {matrix && rows.length === 0 && <p className="text-gray-500">這個班級還沒有指派作業</p>}
        {rows.length > 0 && (
          <table className="w-full text-left" aria-label="作業進度">
            <thead>
              <tr className="text-sm text-gray-500 border-b border-gray-200">
                <th className="py-2 font-medium">作業</th>
                <th className="py-2 font-medium hidden sm:table-cell">到期日</th>
                <th className="py-2 font-medium">已交 / 總數</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-gray-100 ${r.dueState === 'overdue' ? 'bg-red-50' : r.dueState === 'today' ? 'bg-amber-50' : ''}`}
                >
                  <td className="py-3 font-semibold text-gray-900">{r.title}<div className="sm:hidden text-sm font-normal text-gray-500">{formatDue(r)}</div></td>
                  <td className="py-3 text-gray-700 hidden sm:table-cell">{formatDue(r)}</td>
                  <td className="py-3 tabular-nums">{r.submitted} / {r.assigned}</td>
                  <td className="py-3 text-right">
                    <button type="button" onClick={() => onOpenAssignment(r.id)} className="text-accent font-medium hover:underline cursor-pointer">
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default TodayOverviewTab;
