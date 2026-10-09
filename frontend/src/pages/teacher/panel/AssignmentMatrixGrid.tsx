/**
 * 班級作業總表 — 學生 × 老師出的全部作業 (#3367)
 *
 * 老師回饋：矩陣只看老師出的作業、一張表看懂每次上課的完成度。
 * 每一格只有四種狀態，沒有分數就不顯示數字（#3359 的假 0 分就是從這裡來的）。
 */
import React from 'react';
import { STEP_REGISTRY, resolveStepId } from '../../../config/stepConfig';
import { AssignmentMatrixResponse } from '../../../services/teacherApi';

type Cell = AssignmentMatrixResponse['cells'][number];

interface AssignmentMatrixGridProps {
  data: AssignmentMatrixResponse;
  onOpenAssignment: (assignmentId: number) => void;
}

function stepLabel(step: string | null): string | null {
  if (!step) return null;
  return STEP_REGISTRY[resolveStepId(step)]?.label ?? null;
}

function scoreClass(score: number | null): string {
  if (score === null) return 'bg-gray-100 text-gray-600';
  if (score >= 80) return 'bg-green-100 text-green-800';
  if (score >= 60) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-700';
}

export function CellBadge({ cell }: { cell: Cell | undefined }) {
  if (!cell || cell.state === 'not_assigned') {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded text-xs text-gray-400 bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_4px,#e5e7eb_4px,#e5e7eb_8px)]"
        title="這位學生不在這份作業的指派名單內（作業派出後才加入班級）"
      >
        未指派
      </span>
    );
  }
  if (cell.state === 'completed') {
    return (
      <span className={`inline-block min-w-10 px-2 py-0.5 rounded text-sm font-semibold ${scoreClass(cell.score)}`}>
        {cell.score !== null ? Math.round(cell.score) : '已交'}
      </span>
    );
  }
  if (cell.state === 'in_progress') {
    const label = stepLabel(cell.current_step);
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-amber-700 border border-dashed border-amber-400">
        進行中{label ? `・${label}` : ''}
      </span>
    );
  }
  return <span className="text-sm text-gray-400">未開始</span>;
}

function formatDue(due: string | null): string {
  if (!due) return '無期限';
  return new Date(due).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

const AssignmentMatrixGrid: React.FC<AssignmentMatrixGridProps> = ({ data, onOpenAssignment }) => {
  const { students, assignments, cells } = data;

  if (assignments.length === 0) {
    return <p className="py-10 text-center text-gray-500">這個班級還沒有指派作業</p>;
  }
  if (students.length === 0) {
    return <p className="py-10 text-center text-gray-500">這個班級還沒有學生</p>;
  }

  const cellMap = new Map<string, Cell>();
  for (const c of cells) cellMap.set(`${c.student_id}:${c.assignment_id}`, c);

  return (
    <div>
      <div className="overflow-auto max-h-[70vh] border border-gray-200 rounded-xl">
        <table className="min-w-full text-sm border-separate border-spacing-0" aria-label="班級作業總表">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-gray-50 px-4 py-3 text-left font-medium text-gray-600 border-b border-r border-gray-200">
                學生
              </th>
              {assignments.map((a) => (
                <th key={a.id} className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-center border-b border-gray-200 min-w-28">
                  <button
                    type="button"
                    onClick={() => onOpenAssignment(a.id)}
                    className="font-semibold text-accent hover:underline cursor-pointer"
                  >
                    {a.title}
                  </button>
                  <div className="text-xs text-gray-500 font-normal">{formatDue(a.due_date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-gray-900 border-b border-r border-gray-100 whitespace-nowrap">
                  {s.name}
                </th>
                {assignments.map((a) => (
                  <td key={a.id} className="px-3 py-2.5 text-center border-b border-gray-100">
                    <CellBadge cell={cellMap.get(`${s.id}:${a.id}`)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-600">
        <span className="flex items-center gap-1.5"><span className="px-2 py-0.5 rounded bg-green-100 text-green-800 font-semibold">88</span>已完成（依分數上色）</span>
        <span className="flex items-center gap-1.5"><span className="px-2 py-0.5 rounded border border-dashed border-amber-400 text-amber-700 text-xs">進行中</span>做到哪一步</span>
        <span className="flex items-center gap-1.5"><span className="text-gray-400">未開始</span>派了還沒動</span>
        <span className="flex items-center gap-1.5"><span className="px-2 py-0.5 rounded text-xs text-gray-400 bg-gray-100">未指派</span>派作業時還不在班上</span>
      </div>
    </div>
  );
};

export default AssignmentMatrixGrid;
