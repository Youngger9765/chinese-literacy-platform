/**
 * TableExerciseInput — 表格作答 (`table_exercise`): the worksheet's 「在正確的格子裡打勾」
 * and 「完成表格」, answered IN the table.
 *
 *   - matrix cell (`matrixOption`) → one radio/checkbox per column (options = the headers)
 *   - text slot   → an input placed on the cell's empty 【　】 marks, in order
 *   - choice slot in a cell → that cell's options as pickable pills
 *
 * One 確認 grades every slot: ✓ / 再想想 per cell, 再試一次 clears only the wrong ones.
 * `noCorrectAnswer` slots (個人經驗、自我覺察) complete once answered and never show a verdict.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Question, TableSlotT } from '../../../schema/lessonContent';
import { resolveFreeTextCorrect } from '../lessonGrading';

export type TableQuestion = Question & { kind: 'table_exercise' };
type Cell = { text?: string; slots?: string[]; matrixOption?: number | null };

interface Props {
  question: TableQuestion;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** Fired with true once every slot is answered and correct (or has no correct answer). */
  onAllDone?: (done: boolean) => void;
}

const EMPTY_MARK = /【[\s　]*】|（[\s　]+）|\([\s　]+\)/;

function answered(slot: TableSlotT, v: unknown): boolean {
  if (slot.type === 'text') return typeof v === 'string' && v.trim().length > 0;
  if (slot.type === 'multi_choice') return Array.isArray(v) && v.length > 0;
  return typeof v === 'number';
}

function sameSet(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/** One slot's verdict: true = done/correct, false = wrong. */
export function gradeSlot(slot: TableSlotT, v: unknown): boolean {
  if (!answered(slot, v)) return false;
  if (slot.noCorrectAnswer) return true;
  if (slot.type === 'text') {
    if (slot.answer == null) return true; // open answer, no reference printed
    // 「安心/放心」「恩情／恩人」: any printed alternative is accepted
    const alternatives = String(slot.answer).split(/[/／]|或/).map((s) => s.trim()).filter(Boolean);
    return alternatives.some((alt) => resolveFreeTextCorrect(String(v), alt));
  }
  if (slot.type === 'multi_choice') return sameSet(v, slot.answer);
  return v === slot.answer;
}

const TableExerciseInput: React.FC<Props> = ({ question, value, onChange, onAllDone }) => {
  const slots = useMemo(() => new Map(question.slots.map((s) => [s.id, s])), [question.slots]);
  const [verdict, setVerdict] = useState<Record<string, boolean>>({});
  const submitted = Object.keys(verdict).length > 0;

  // Saved progress arriving at mount is re-graded once; the student's own first edit is not
  // (same trap GuidedStepsInput had: a first pick taken for restored progress).
  const restoredRef = useRef(false);
  const localEditRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || Object.keys(value).length === 0) return;
    restoredRef.current = true;
    if (localEditRef.current) return;
    if (question.slots.every((s) => answered(s, value[s.id]))) {
      setVerdict(Object.fromEntries(question.slots.map((s) => [s.id, gradeSlot(s, value[s.id])])));
    }
  }, [value, question.slots]);

  const allDone = submitted && question.slots.every((s) => verdict[s.id] === true);
  useEffect(() => {
    onAllDone?.(allDone);
  }, [allDone, onAllDone]);

  const set = (sid: string, v: unknown) => {
    localEditRef.current = true;
    onChange({ ...value, [sid]: v });
  };
  const locked = (sid: string) => verdict[sid] === true;
  const allAnswered = question.slots.every((s) => answered(s, value[s.id]));
  const wrong = question.slots.filter((s) => verdict[s.id] === false).length;

  const confirm = () => {
    setVerdict(Object.fromEntries(question.slots.map((s) => [s.id, gradeSlot(s, value[s.id])])));
  };
  const retry = () => {
    const next = { ...value };
    for (const s of question.slots) {
      if (verdict[s.id] === false) delete next[s.id]; // keep what was right, clear what was wrong
    }
    localEditRef.current = true;
    onChange(next);
    setVerdict({});
  };

  const mark = (slot: TableSlotT) => {
    const v = verdict[slot.id];
    if (v === undefined || slot.noCorrectAnswer) return null;
    return v ? (
      <span className="ml-1 text-emerald-600 font-bold" aria-label="答對">✓</span>
    ) : (
      <span className="ml-1 text-amber-600 font-bold" aria-label="再想想">✗</span>
    );
  };

  const choicePills = (slot: TableSlotT) => {
    const v = value[slot.id];
    const multi = slot.type === 'multi_choice';
    const picked = (oi: number) => (multi ? Array.isArray(v) && (v as number[]).includes(oi) : v === oi);
    return (
      <div className="mt-1 flex flex-wrap gap-1.5" role={multi ? 'group' : 'radiogroup'}>
        {slot.options.map((opt, oi) => (
          <button
            key={oi}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={picked(oi)}
            disabled={locked(slot.id) || submitted}
            onClick={() => {
              if (!multi) return set(slot.id, oi);
              const cur = Array.isArray(v) ? (v as number[]) : [];
              set(slot.id, cur.includes(oi) ? cur.filter((x) => x !== oi) : [...cur, oi].sort((a, b) => a - b));
            }}
            className={[
              'rounded-lg border px-2.5 py-1 text-sm text-left whitespace-pre-wrap transition-colors',
              picked(oi) ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-gray-300 hover:border-violet-300',
            ].join(' ')}
          >
            {opt}
          </button>
        ))}
        {mark(slot)}
      </div>
    );
  };

  const textInput = (slot: TableSlotT, key: React.Key) => (
    <span key={key} className="inline-flex items-center">
      <input
        type="text"
        aria-label="填寫"
        value={String(value[slot.id] ?? '')}
        disabled={locked(slot.id) || submitted}
        onChange={(e) => set(slot.id, e.target.value)}
        className="mx-1 min-w-[5rem] max-w-full border-b border-gray-400 bg-transparent px-1 text-base focus:outline-none focus:border-violet-500"
      />
      {mark(slot)}
    </span>
  );

  const renderCell = (cell: Cell, ri: number, ci: number) => {
    const cellSlots = cell.slots ?? [];
    // 打勾矩陣：這一格就是某一個選項
    if (cell.matrixOption != null) {
      const slot = slots.get(cellSlots[0])!;
      const multi = slot.type === 'multi_choice';
      const v = value[slot.id];
      const oi = cell.matrixOption;
      const checked = multi ? Array.isArray(v) && (v as number[]).includes(oi) : v === oi;
      return (
        <td key={ci} className="border border-gray-200 px-3 py-2 text-center align-middle">
          <input
            type={multi ? 'checkbox' : 'radio'}
            name={`${slot.id}`}
            aria-label={`第 ${ri + 1} 列：${slot.options[oi]}`}
            checked={checked}
            disabled={locked(slot.id) || submitted}
            onChange={() => {
              if (!multi) return set(slot.id, oi);
              const cur = Array.isArray(v) ? (v as number[]) : [];
              set(slot.id, cur.includes(oi) ? cur.filter((x) => x !== oi) : [...cur, oi].sort((a, b) => a - b));
            }}
            className="h-5 w-5 accent-violet-600 cursor-pointer"
          />
          {/* ✓／✗ 標在學生勾的那一格旁邊，不是固定在最後一欄 */}
          {checked ? mark(slot) : null}
        </td>
      );
    }
    const textSlots = cellSlots.map((sid) => slots.get(sid)!).filter((s) => s.type === 'text');
    const choiceSlots = cellSlots.map((sid) => slots.get(sid)!).filter((s) => s.type !== 'text');
    const parts = (cell.text ?? '').split(EMPTY_MARK);
    const inline: React.ReactNode[] = [];
    let used = 0;
    parts.forEach((part, i) => {
      inline.push(<span key={`t${i}`}>{part}</span>);
      if (i < parts.length - 1) {
        const slot = textSlots[used];
        if (slot) {
          inline.push(textInput(slot, `s${i}`));
          used += 1;
        } else {
          inline.push(<span key={`m${i}`}>【　】</span>); // printed blank that is not a slot
        }
      }
    });
    return (
      <td key={ci} className="border border-gray-200 px-3 py-2 align-top whitespace-pre-wrap">
        {inline}
        {textSlots.slice(used).map((s, i) => (
          <div key={`x${i}`}>{textInput(s, i)}</div>
        ))}
        {choiceSlots.map((s) => (
          <div key={s.id}>{choicePills(s)}</div>
        ))}
      </td>
    );
  };

  return (
    <div className="space-y-3" data-testid="table-exercise">
      <p className="text-base text-on-surface whitespace-pre-wrap">{question.instruction}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-base">
          {question.headers.length > 0 && (
            <thead>
              <tr className="bg-violet-50">
                {question.headers.map((h, i) => (
                  <th key={i} className="border border-gray-200 px-3 py-2 text-left font-medium align-top whitespace-pre-wrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {question.rows.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => renderCell(cell as Cell, ri, ci))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {!submitted ? (
        <button
          type="button"
          onClick={confirm}
          disabled={!allAnswered}
          className="px-5 py-2 rounded-full text-base font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40"
        >
          確認
        </button>
      ) : wrong > 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-3">
          <p className="text-base font-medium text-amber-800">有 {wrong} 格再想想看</p>
          <button type="button" onClick={retry} className="text-sm font-medium text-violet-700 underline underline-offset-2">
            再試一次
          </button>
        </div>
      ) : (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5">
          <p className="text-base font-medium text-emerald-700">✓ 表格完成</p>
        </div>
      )}
    </div>
  );
};

export default TableExerciseInput;
