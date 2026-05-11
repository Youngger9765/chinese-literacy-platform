/**
 * StoryStructureTable — 互動式文章重點表 (#615, #845, #1082)
 *
 * Fetches AI-generated story structure from /api/stories/{id}/structure.
 * Supports interactive fill-in-the-blank and checkbox questions with AI grading.
 * Genre-aware: 記敘文 shows 主角/主題/事例, 說明文 shows concept structure, etc.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

type InteractiveType = 'fill_blank' | 'checkbox' | 'display';

interface StructureSubRow {
  label: string;
  value: string;
  interactive_type: InteractiveType;
  hint?: string;
  options?: string[];
  correct_options?: number[];
}

interface StructureRow {
  label: string;
  value: string;
  interactive_type: InteractiveType;
  hint?: string;
  options?: string[];
  correct_options?: number[];
  sub_rows?: StructureSubRow[];
}

interface StructureData {
  rows: StructureRow[];
}

interface GradeResultItem {
  row_index: number;
  sub_row_index?: number;
  correct: boolean;
  feedback: string;
  correct_answer: string;
}

interface GradeResult {
  results: GradeResultItem[];
  score: number;
}

// Answer state key: "rowIdx" for top-level, "rowIdx-subIdx" for sub-rows
type AnswerMap = Record<string, string | number[]>;

interface Props {
  storyId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function answerKey(rowIdx: number, subIdx?: number): string {
  return subIdx !== undefined ? `${rowIdx}-${subIdx}` : `${rowIdx}`;
}

function findGradeItem(
  results: GradeResultItem[],
  rowIdx: number,
  subIdx?: number,
): GradeResultItem | undefined {
  return results.find(
    (r) => r.row_index === rowIdx && r.sub_row_index === subIdx,
  );
}

// ── FillBlankCell ─────────────────────────────────────────────────────────────

interface FillBlankCellProps {
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  submitted: boolean;
  gradeItem?: GradeResultItem;
}

const FillBlankCell: React.FC<FillBlankCellProps> = ({
  hint,
  value,
  onChange,
  submitted,
  gradeItem,
}) => {
  if (submitted && gradeItem) {
    const isCorrect = gradeItem.correct;
    return (
      <div className="flex flex-col gap-1">
        <div
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium border ${
            isCorrect
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-red-50 text-red-800 border-red-300'
          }`}
        >
          <span>{isCorrect ? '✓' : '✗'}</span>
          <span>{value || '（未填）'}</span>
        </div>
        {!isCorrect && (
          <p className="text-xs text-gray-500 pl-1">{gradeItem.feedback}</p>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5 text-gray-700 text-sm">
      <span className="text-gray-400 font-medium">【</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint ?? '請填入答案'}
        className="w-36 bg-amber-50 border-b-2 border-amber-400 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-amber-600 px-1 py-0.5 text-center"
        disabled={submitted}
      />
      <span className="text-gray-400 font-medium">】</span>
    </div>
  );
};

// ── CheckboxCell ──────────────────────────────────────────────────────────────

interface CheckboxCellProps {
  options: string[];
  selected: number[];
  onChange: (indices: number[]) => void;
  submitted: boolean;
  gradeItem?: GradeResultItem;
  correctOptions?: number[];
}

const CheckboxCell: React.FC<CheckboxCellProps> = ({
  options,
  selected,
  onChange,
  submitted,
  gradeItem,
  correctOptions,
}) => {
  const toggle = (idx: number) => {
    if (submitted) return;
    if (selected.includes(idx)) {
      onChange(selected.filter((i) => i !== idx));
    } else {
      onChange([...selected, idx]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {options.map((opt, idx) => {
        const isSelected = selected.includes(idx);
        const isCorrectOption = (correctOptions ?? []).includes(idx);

        let rowStyle =
          'border-gray-300 bg-white text-gray-800 hover:border-amber-400 hover:bg-amber-50';
        let boxStyle = 'border-gray-400';

        if (submitted && gradeItem) {
          if (isCorrectOption) {
            rowStyle = 'border-emerald-400 bg-emerald-50 text-emerald-800';
            boxStyle = 'border-emerald-500 bg-emerald-500 text-white';
          } else if (isSelected) {
            rowStyle = 'border-red-400 bg-red-50 text-red-700';
            boxStyle = 'border-red-400 bg-red-100';
          } else {
            rowStyle = 'border-gray-200 bg-gray-50 text-gray-400';
          }
        } else if (isSelected) {
          rowStyle = 'border-amber-500 bg-amber-100 text-amber-900';
          boxStyle = 'border-amber-500 bg-amber-500 text-white';
        }

        return (
          <label
            key={idx}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors select-none ${rowStyle} ${
              submitted ? 'cursor-default' : 'cursor-pointer'
            }`}
          >
            <span
              className={`w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center text-xs ${boxStyle}`}
            >
              {(submitted && isCorrectOption) || (!submitted && isSelected) ? '✓' : ''}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={isSelected}
              onChange={() => toggle(idx)}
              disabled={submitted}
            />
            {opt}
            {submitted && gradeItem && isCorrectOption && (
              <span className="ml-auto text-xs text-emerald-600 font-medium">正確</span>
            )}
          </label>
        );
      })}
      {submitted && gradeItem && !gradeItem.correct && (
        <p className="text-xs text-gray-500 pl-1">{gradeItem.feedback}</p>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const StoryStructureTable: React.FC<Props> = ({ storyId }) => {
  const { token } = useAuth();
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);

  const API_BASE = import.meta.env.VITE_API_URL || '';

  useEffect(() => {
    setLoading(true);
    setFetchError(false);
    setAnswers({});
    setGradeResult(null);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`${API_BASE}/api/stories/${storyId}/structure`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: StructureData) => setStructure(data))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [storyId, token, API_BASE]);

  const setAnswer = useCallback((key: string, value: string | number[]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Build the answer payload for POST /structure/grade
  const buildAnswerPayload = useCallback((): object[] => {
    if (!structure) return [];
    const payload: object[] = [];

    structure.rows.forEach((row, rowIdx) => {
      if (row.sub_rows && row.sub_rows.length > 0) {
        row.sub_rows.forEach((sub, subIdx) => {
          if (sub.interactive_type === 'display') return;
          const key = answerKey(rowIdx, subIdx);
          const val = answers[key];
          if (sub.interactive_type === 'checkbox') {
            payload.push({
              row_index: rowIdx,
              sub_row_index: subIdx,
              selected_options: Array.isArray(val) ? val : [],
            });
          } else {
            payload.push({
              row_index: rowIdx,
              sub_row_index: subIdx,
              value: typeof val === 'string' ? val : '',
            });
          }
        });
      } else {
        if (row.interactive_type === 'display') return;
        const key = answerKey(rowIdx);
        const val = answers[key];
        if (row.interactive_type === 'checkbox') {
          payload.push({
            row_index: rowIdx,
            selected_options: Array.isArray(val) ? val : [],
          });
        } else {
          payload.push({
            row_index: rowIdx,
            value: typeof val === 'string' ? val : '',
          });
        }
      }
    });

    return payload;
  }, [structure, answers]);

  const handleSubmit = useCallback(async () => {
    if (!structure || submitting || gradeResult !== null) return;
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/stories/${storyId}/structure/grade`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ answers: buildAnswerPayload() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GradeResult = await res.json();
      setGradeResult(data);
    } catch {
      setGradeResult({ results: [], score: -1 });
    } finally {
      setSubmitting(false);
    }
  }, [structure, submitting, gradeResult, token, storyId, API_BASE, buildAnswerPayload]);

  // Count total interactive fields and how many are answered
  const { totalInteractive, totalAnswered } = (() => {
    if (!structure) return { totalInteractive: 0, totalAnswered: 0 };
    let total = 0;
    let answered = 0;
    structure.rows.forEach((row, rowIdx) => {
      const targets = row.sub_rows?.length
        ? row.sub_rows.map((s, si) => ({ ...s, _key: answerKey(rowIdx, si) }))
        : [{ ...row, _key: answerKey(rowIdx) }];

      targets.forEach(({ interactive_type, _key }) => {
        if (interactive_type === 'display') return;
        total++;
        const val = answers[_key];
        if (interactive_type === 'checkbox') {
          if (Array.isArray(val) && val.length > 0) answered++;
        } else {
          if (typeof val === 'string' && val.trim().length > 0) answered++;
        }
      });
    });
    return { totalInteractive: total, totalAnswered: answered };
  })();

  const allAnswered = totalAnswered >= totalInteractive && totalInteractive > 0;
  const submitted = gradeResult !== null;
  const gradeResults = gradeResult?.results ?? [];
  const score = gradeResult?.score ?? 0;

  // renderCellContent must be declared BEFORE any early returns to satisfy Rules of Hooks.
  // When loading=true or structure=null, this hook still runs but is never called.
  const renderCellContent = useCallback(
    (
      cell: StructureRow | StructureSubRow,
      rowIdx: number,
      subIdx?: number,
    ) => {
      if (cell.interactive_type === 'display') {
        return <span className="text-gray-800 leading-relaxed">{cell.value}</span>;
      }
      const key = answerKey(rowIdx, subIdx);
      const gradeItem = submitted ? findGradeItem(gradeResults, rowIdx, subIdx) : undefined;
      if (cell.interactive_type === 'checkbox') {
        return (
          <CheckboxCell
            options={cell.options ?? []}
            selected={Array.isArray(answers[key]) ? (answers[key] as number[]) : []}
            onChange={(v) => setAnswer(key, v)}
            submitted={submitted}
            gradeItem={gradeItem}
            correctOptions={cell.correct_options}
          />
        );
      }
      return (
        <FillBlankCell
          hint={cell.hint}
          value={typeof answers[key] === 'string' ? (answers[key] as string) : ''}
          onChange={(v) => setAnswer(key, v)}
          submitted={submitted}
          gradeItem={gradeItem}
        />
      );
    },
    [answers, submitted, gradeResults, setAnswer],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-400 text-sm">
        <span className="animate-spin mr-2">⏳</span> 正在整理文章重點…
      </div>
    );
  }

  if (fetchError || !structure) {
    return (
      <div className="p-4 text-sm text-red-500 text-center">
        無法載入文章重點表，請重新整理頁面
      </div>
    );
  }

  const { rows } = structure;

  return (
    <div className="overflow-hidden rounded-xl border-2 border-gray-300 shadow-sm max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-amber-50 border-b-2 border-amber-400 px-5 py-3 flex items-center justify-between">
        <span className="text-amber-800 font-bold text-base">📋 文章重點表</span>
        {submitted && score >= 0 && (
          <span
            className={`text-sm font-bold px-3 py-1 rounded-full ${
              score >= 80
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {score >= 80 ? '🎉 表現超棒！' : '💪 繼續加油'}
          </span>
        )}
      </div>

      {/* #1534: card layout — yellow row banner + per-sub_row body; bare banner when display with empty value (avoids huge blank cell). */}
      <div className="divide-y-2 divide-gray-200 text-base">
        {rows.map((row, rowIdx) => {
          const hasSubRows = !!(row.sub_rows && row.sub_rows.length > 0);
          const topLevelEmptyDisplay =
            !hasSubRows && row.interactive_type === 'display' && !row.value?.trim();

          return (
            <section key={`${rowIdx}-${row.label}`}>
              {/* Yellow header — row.label as horizontal banner */}
              <div className="bg-amber-50 px-4 py-2.5 font-bold text-gray-800 leading-snug">
                {row.label}
              </div>

              {hasSubRows ? (
                <div className="divide-y divide-gray-200">
                  {(row.sub_rows ?? []).map((sub, subIdx) => (
                    <div key={`${subIdx}-${sub.label}`}>
                      {/* Gray sub-label — horizontal banner */}
                      <div className="bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600 leading-snug">
                        {sub.label}
                      </div>
                      <div className="px-4 py-3">
                        {renderCellContent(sub, rowIdx, subIdx)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : topLevelEmptyDisplay ? null : (
                <div className="px-4 py-3">
                  {renderCellContent(row, rowIdx)}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Submit / Result bar */}
      <div className="px-5 py-4 border-t-2 border-gray-200 bg-gray-50">
        {!submitted ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              已填 {totalAnswered} / {totalInteractive} 題
            </p>
            <button
              onClick={handleSubmit}
              disabled={!allAnswered || submitting}
              className={`px-6 py-2 rounded-xl font-bold text-sm transition-all ${
                allAnswered && !submitting
                  ? 'bg-amber-500 text-white hover:bg-amber-600 active:scale-95'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {submitting ? '批改中…' : '提交答案'}
            </button>
          </div>
        ) : score < 0 ? (
          <p className="text-sm text-red-500 text-center">
            批改失敗，請重新整理後再試
          </p>
        ) : (
          <div
            className={`rounded-xl p-4 text-center ${
              score >= 80
                ? 'bg-emerald-50 border border-emerald-200'
                : 'bg-amber-50 border border-amber-200'
            }`}
          >
            <p className="font-bold text-gray-900">
              {score >= 80 ? '太棒了！' : '繼續加油！'}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {score >= 80
                ? '你已掌握這篇課文的重點'
                : '可以再讀一遍課文，試著找出關鍵句子'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryStructureTable;
