/**
 * 能力 × 課文矩陣與一句話診斷（#4162）
 *
 * 列是五項能力、欄是最近 6 課，格子顏色用第一次答對率（與老師端熱度矩陣同一套門檻）。
 * 做不到兩課時只顯示已有的格，其餘灰色並寫「再做 N 課就能比較」。
 */
import React from 'react';
import { RADAR_AXES } from './reportCardsModel';
import {
  bandOf,
  diagnose,
  lessonsNeeded,
  matrixOf,
  type Band,
  type LessonAbility,
} from './abilityHistory';

const BAND_CLASS: Record<Band, string> = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  low: 'bg-orange-100 text-orange-800',
  none: 'bg-surface-container text-on-surface-variant',
};
const BAND_TEXT: Record<Band, string> = {
  green: '80 分以上', yellow: '60 到 79 分', low: '低於 60 分', none: '沒做',
};

const firstStepOf = (axisKey: string): string =>
  RADAR_AXES.find((a) => a.key === axisKey)?.steps[0] ?? '';

interface Props {
  /** 由舊到新，最後一個是目前看的這一課 */
  lessons: LessonAbility[];
  /** 點格子或診斷建議：跳到該課該關 */
  onGoToLessonStep?: (storyId: string, stepId: string) => void;
}

const AbilityMatrixPanel: React.FC<Props> = ({ lessons, onGoToLessonStep }) => {
  const matrix = matrixOf(lessons);
  const diagnosis = diagnose(lessons);
  const need = lessonsNeeded(matrix.columns.length);

  return (
    <section className="rounded-3xl bg-surface-container-lowest shadow-editorial p-6" data-testid="ability-matrix">
      <h3 className="font-headline font-bold text-lg text-on-surface">最近幾課的能力變化</h3>
      <p className="text-xs text-on-surface-variant mt-1">
        每格是該課這項能力的成績（答題類看第一次就答對的比例，朗讀看正確率）：綠色 80 分以上、黃色 60 到 79 分、橘色低於 60 分、灰色沒做
      </p>

      {diagnosis && (
        <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900" data-testid="ability-diagnosis">
          {diagnosis.text}
          {onGoToLessonStep && (() => {
            const target = lessons[lessons.length - 1];
            return target ? (
              <button
                type="button"
                className="ml-2 underline font-bold"
                onClick={() => onGoToLessonStep(target.storyId, diagnosis.suggestedStepId)}
              >
                現在就去做
              </button>
            ) : null;
          })()}
        </p>
      )}

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm border-separate border-spacing-1">
          <caption className="sr-only">能力與課文的第一次答對率對照表</caption>
          <thead>
            <tr>
              <th className="text-left font-normal text-xs text-on-surface-variant w-24" scope="col">能力</th>
              {matrix.columns.map((c) => (
                <th key={c.sessionId} scope="col" className="font-normal text-xs text-on-surface-variant max-w-[6rem] truncate" title={c.title}>
                  {c.title}
                </th>
              ))}
              {Array.from({ length: matrix.padding }).map((_, i) => (
                <th key={`pad-${i}`} scope="col" className="font-normal text-xs text-on-surface-variant">—</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="text-left font-medium text-on-surface">{row.label}</th>
                {row.cells.map((cell, i) => {
                  const col = matrix.columns[i];
                  const text = cell.value === null ? '—' : String(cell.value);
                  const label = `${row.label}，${col.title}，${cell.value === null ? '沒做' : `${cell.value} 分，${BAND_TEXT[bandOf(cell.value)]}`}`;
                  return (
                    <td key={col.sessionId} className="p-0">
                      <button
                        type="button"
                        data-band={cell.band}
                        aria-label={label}
                        disabled={!onGoToLessonStep || cell.value === null}
                        onClick={() => onGoToLessonStep?.(col.storyId, firstStepOf(row.key))}
                        className={`w-full h-10 rounded-lg font-bold ${BAND_CLASS[cell.band]}`}
                      >
                        {text}
                      </button>
                    </td>
                  );
                })}
                {Array.from({ length: matrix.padding }).map((_, i) => (
                  <td key={`pad-${i}`} className="p-0">
                    <div data-band="none" className={`w-full h-10 rounded-lg ${BAND_CLASS.none}`} aria-hidden="true" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {need > 0 && (
        <p className="mt-3 text-sm text-on-surface-variant" data-testid="ability-need-more">
          再做 {need} 課就能比較
        </p>
      )}
    </section>
  );
};

export default AbilityMatrixPanel;
