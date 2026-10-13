/**
 * One assignment's results as CSV (Khan Academy offers this per assignment; we
 * only had a whole-class export). Built from the matrix already on screen.
 */
import type { AssignmentMatrixResponse } from '../../../services/teacherApi';

type Cell = AssignmentMatrixResponse['cells'][number];

function stateLabel(cell: Cell | undefined, overdue: boolean): string {
  if (!cell || cell.state === 'not_assigned') return '未指派';
  if (cell.state === 'completed') return '已交';
  if (overdue) return '逾期未交';
  return cell.state === 'in_progress' ? '進行中' : '未開始';
}

// Names can come from students (Junyi nicknames). A cell starting with = + - @
// (or tab / CR) runs as a formula when the teacher opens the file in Excel, so
// prefix it with ' to keep it text (OWASP CSV injection guidance).
const neutralise = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const field = (raw: string) => {
  const v = neutralise(raw);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function assignmentCsv(matrix: AssignmentMatrixResponse, assignmentId: number, overdue: boolean): string {
  const byStudent = new Map<number, Cell>();
  for (const c of matrix.cells) if (c.assignment_id === assignmentId) byStudent.set(c.student_id, c);
  const rows = matrix.students.map((s) => {
    const cell = byStudent.get(s.id);
    const score = cell?.state === 'completed' && cell.score !== null ? String(Math.round(cell.score)) : '';
    return [field(s.name), stateLabel(cell, overdue), score].join(',');
  });
  return ['學生,狀態,分數', ...rows].join('\r\n');
}

/** Download with a BOM so Excel opens the Chinese correctly. */
export function downloadAssignmentCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
