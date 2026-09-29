/**
 * tableExercise.test.tsx — 表格作答 (`table_exercise`): the worksheet's
 * 「在正確的格子裡打勾」 and 「完成表格」 are answered IN the table, not in a copy below it.
 *
 * Wire-shaped fixture (snake_case, as lesson_content_loader emits it), parsed through the
 * real camelizeKeys + LessonSchema path the API client uses.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { camelizeKeys } from '../../../schema/camelize';
import { LessonSchema } from '../../../schema/lessonContent';
import TableExerciseInput, { gradeSlot, type TableQuestion } from '../inputs/TableExerciseInput';

const wire = {
  id: 'LTEST',
  lesson_code: 'LTEST',
  blocks: [
    {
      id: 'ex-table-1',
      type: 'exercise',
      question: {
        kind: 'table_exercise',
        instruction: '請判斷下面的內容，並在正確的格子裡打勾。',
        headers: ['內容', '做的事', '說的話', '重要細節'],
        rows: [
          [
            { text: '①「我一定會做好。」' },
            { text: '', slots: ['r1.s1'], matrix_option: 0 },
            { text: '', slots: ['r1.s1'], matrix_option: 1 },
            { text: '身體顏色【　】，不容易被【　】', slots: ['r1.s2', 'r1.s3'] },
          ],
          [
            { text: '②你最常做的事？' },
            { text: '', slots: ['r2.s1'], matrix_option: 0 },
            { text: '', slots: ['r2.s1'], matrix_option: 1 },
            { text: '' },
          ],
        ],
        slots: [
          { id: 'r1.s1', type: 'choice', options: ['做的事', '說的話'], answer: 1 },
          { id: 'r1.s2', type: 'text', answer: '接近四周環境' },
          { id: 'r1.s3', type: 'text', answer: '安心/放心' },
          { id: 'r2.s1', type: 'choice', options: ['做的事', '說的話'], no_correct_answer: true },
        ],
      },
      answer_space: 'free_text',
      answer: { 'r1.s1': 1, 'r1.s2': '接近四周環境', 'r1.s3': '安心/放心', 'r2.s1': null },
      grader: 'rubric_ai',
      anchors: [],
      needs_review: false,
    },
  ],
};

const lesson = LessonSchema.parse(camelizeKeys(wire));
const q = (lesson.blocks[0] as { question: TableQuestion }).question;

function Harness({ onDone }: { onDone: (d: boolean) => void }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return <TableExerciseInput question={q} value={value} onChange={setValue} onAllDone={onDone} />;
}

describe('table_exercise contract', () => {
  it('parses, and rejects a cell that points at a slot that does not exist', () => {
    expect(q.slots).toHaveLength(4);
    const bad = structuredClone(wire);
    (bad.blocks[0].question.rows[0][1] as { slots: string[] }).slots = ['nope'];
    expect(LessonSchema.safeParse(camelizeKeys(bad)).success).toBe(false);
  });

  it('rejects an answer on a no-correct-answer slot', () => {
    const bad = structuredClone(wire);
    (bad.blocks[0].question.slots[3] as { answer?: number }).answer = 0;
    expect(LessonSchema.safeParse(camelizeKeys(bad)).success).toBe(false);
  });
});

describe('answering in the table', () => {
  it('ticks the grid cell, fills the 【　】 in place, and grades every slot on 確認', () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    const table = screen.getByRole('table');

    // the tick grid: one radio per column cell, inside the table itself
    const tick = within(table).getByLabelText('第 1 列：做的事');
    expect(tick.getAttribute('type')).toBe('radio');
    fireEvent.click(tick); // wrong on purpose: the answer is 說的話
    fireEvent.click(within(table).getByLabelText('第 2 列：說的話'));

    const inputs = within(table).getAllByLabelText('填寫');
    expect(inputs).toHaveLength(2); // the two 【　】 marks became inputs
    fireEvent.change(inputs[0], { target: { value: '接近四周環境' } });
    fireEvent.change(inputs[1], { target: { value: '放心' } }); // printed alternative

    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText('有 1 格再想想看')).toBeTruthy();
    expect(onDone).toHaveBeenLastCalledWith(false);

    // 再試一次 clears only the wrong cell
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    expect((within(table).getAllByLabelText('填寫')[0] as HTMLInputElement).value).toBe('接近四周環境');
    fireEvent.click(within(table).getByLabelText('第 1 列：說的話'));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText('✓ 表格完成')).toBeTruthy();
    expect(onDone).toHaveBeenLastCalledWith(true);
  });

  it('確認 waits until every slot is answered', () => {
    render(<Harness onDone={() => {}} />);
    const confirm = screen.getByRole('button', { name: '確認' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('第 1 列：說的話'));
    expect(confirm.disabled).toBe(true);
  });
});

describe('gradeSlot', () => {
  it('no-correct-answer slots complete once answered; open text slots complete once written', () => {
    expect(gradeSlot(q.slots[3], 0)).toBe(true);
    expect(gradeSlot(q.slots[3], undefined)).toBe(false);
    expect(gradeSlot({ id: 'x', type: 'text', options: [], answer: null, noCorrectAnswer: false }, '我的想法')).toBe(true);
    expect(gradeSlot(q.slots[2], '恩人')).toBe(false);
  });
});
