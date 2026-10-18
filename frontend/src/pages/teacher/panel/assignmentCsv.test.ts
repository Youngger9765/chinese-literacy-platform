import { describe, it, expect } from 'vitest';
import { assignmentCsv } from './assignmentCsv';

// Khan Academy lets a teacher download one assignment's scores as CSV; we only
// had a whole-class export. Built from the matrix the page already loaded.
const matrix = {
  students: [
    { id: 1, name: '王小明' },
    { id: 2, name: '李,小華' },
    { id: 3, name: '陳"柏宇"' },
    { id: 4, name: '林雨萱' },
  ],
  assignments: [{ id: 10, title: '課文', due_date: null }],
  cells: [
    { student_id: 1, assignment_id: 10, state: 'completed', score: 87.6, current_step: null },
    { student_id: 2, assignment_id: 10, state: 'in_progress', score: null, current_step: null },
    { student_id: 3, assignment_id: 10, state: 'not_started', score: null, current_step: null },
    { student_id: 4, assignment_id: 10, state: 'not_assigned', score: null, current_step: null },
  ],
} as never;

describe('assignmentCsv', () => {
  it('one row per student: name, status, rounded score; quotes commas and quotes', () => {
    expect(assignmentCsv(matrix, 10, false).split('\r\n')).toEqual([
      '學生,狀態,分數',
      '王小明,已交,88',
      '"李,小華",進行中,',
      '"陳""柏宇""",未開始,',
      '林雨萱,未指派,',
    ]);
  });

  it('past due, unfinished students read 逾期未交', () => {
    const rows = assignmentCsv(matrix, 10, true).split('\r\n');
    expect(rows[2]).toBe('"李,小華",逾期未交,');
    expect(rows[3]).toBe('"陳""柏宇""",逾期未交,');
    expect(rows[1]).toBe('王小明,已交,88');
  });
});

describe('assignmentCsv — formula injection', () => {
  it('a name starting with = + - @ is written as text, not a formula', () => {
    const m = {
      students: [{ id: 1, name: '=HYPERLINK("http://x","y")' }, { id: 2, name: '+1' }, { id: 3, name: '-2' }, { id: 4, name: '@cmd' }],
      assignments: [{ id: 10, title: 't', due_date: null }],
      cells: [],
    } as never;
    const rows = assignmentCsv(m, 10, false).split('\r\n').slice(1);
    expect(rows).toEqual([
      `"'=HYPERLINK(""http://x"",""y"")",未指派,`,
      "'+1,未指派,",
      "'-2,未指派,",
      "'@cmd,未指派,",
    ]);
  });
});
