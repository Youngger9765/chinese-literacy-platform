/**
 * ReadingGoalsForm — teacher UI to set per-assignment reading goals.
 * Used in assignment creation flow and assignment detail edit.
 *
 * Issue #84: 課文目標設定（語速、正確率門檻）
 */
import React from 'react';
import { DEFAULT_TARGET_CPM, DEFAULT_TARGET_ACCURACY } from '../../services/assignmentApi';

export interface GoalsFormState {
  target_cpm: number | null;
  target_accuracy: number | null;
  difficulty_label: string | null;
}

interface ReadingGoalsFormProps {
  value: GoalsFormState;
  onChange: (updated: GoalsFormState) => void;
  grade?: number | null; // student grade (4-9) for suggested defaults
}

/** Grade-based CPM suggestions (PRD: 流暢朗讀標準) */
function suggestCpmForGrade(grade: number | null | undefined): number {
  if (!grade) return DEFAULT_TARGET_CPM;
  if (grade <= 4) return 120;
  if (grade <= 6) return 150;
  return 170;
}

const DIFFICULTY_OPTIONS = ['初級', '中級', '高級'] as const;

const ReadingGoalsForm: React.FC<ReadingGoalsFormProps> = ({ value, onChange, grade }) => {
  const suggestedCpm = suggestCpmForGrade(grade);

  const handleUseSuggested = () => {
    onChange({
      ...value,
      target_cpm: suggestedCpm,
      target_accuracy: DEFAULT_TARGET_ACCURACY,
    });
  };

  const handleClear = () => {
    onChange({ target_cpm: null, target_accuracy: null, difficulty_label: null });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">朗讀目標設定</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUseSuggested}
            className="text-xs text-blue-600 hover:underline"
          >
            使用建議值
            {grade ? `（${grade}年級：${suggestedCpm}字/分）` : ''}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-gray-400 hover:underline"
          >
            清除（使用預設）
          </button>
        </div>
      </div>

      {/* Difficulty label */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">難度標籤</label>
        <div className="flex gap-2">
          {DIFFICULTY_OPTIONS.map((opt) => {
            const isSelected = value.difficulty_label === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={isSelected}
                data-selected={isSelected ? 'true' : 'false'}
                onClick={() =>
                  onChange({
                    ...value,
                    difficulty_label: isSelected ? null : opt,
                  })
                }
                className={`px-3 py-1 rounded-full text-sm border transition-all ${
                  isSelected
                    ? 'border-blue-700 bg-blue-700 text-white font-bold shadow-sm scale-105'
                    : 'border-gray-300 bg-white text-gray-600 font-medium hover:border-blue-400 hover:scale-102'
                }`}
              >
                {opt}
              </button>
            );
          })}
          {value.difficulty_label && (
            <button
              type="button"
              onClick={() => onChange({ ...value, difficulty_label: null })}
              className="text-xs text-gray-400 hover:underline self-center ml-1"
            >
              取消
            </button>
          )}
        </div>
      </div>

      {/* Target CPM */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          目標語速（字/分）
          <span className="ml-1 text-gray-400">
            — 未設定時使用預設值 {DEFAULT_TARGET_CPM} 字/分
          </span>
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={30}
            max={300}
            step={5}
            value={value.target_cpm ?? DEFAULT_TARGET_CPM}
            onChange={(e) =>
              onChange({ ...value, target_cpm: Number(e.target.value) })
            }
            className="flex-1"
          />
          <div className="w-20 flex items-center gap-1">
            <input
              type="number"
              min={30}
              max={600}
              value={value.target_cpm ?? ''}
              placeholder={String(DEFAULT_TARGET_CPM)}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange({ ...value, target_cpm: e.target.value === '' ? null : n });
              }}
              className="w-16 text-sm border border-gray-200 rounded px-2 py-1 text-center"
            />
            <span className="text-xs text-gray-400">字/分</span>
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-0.5 px-1">
          <span>緩慢 30</span>
          <span>流利 {suggestedCpm}</span>
          <span>快速 300</span>
        </div>
      </div>

      {/* Target accuracy */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          目標正確率（%）
          <span className="ml-1 text-gray-400">
            — 未設定時使用預設值 {DEFAULT_TARGET_ACCURACY}%
          </span>
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={value.target_accuracy ?? DEFAULT_TARGET_ACCURACY}
            onChange={(e) =>
              onChange({ ...value, target_accuracy: Number(e.target.value) })
            }
            className="flex-1"
          />
          <div className="w-20 flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={100}
              value={value.target_accuracy ?? ''}
              placeholder={String(DEFAULT_TARGET_ACCURACY)}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange({ ...value, target_accuracy: e.target.value === '' ? null : n });
              }}
              className="w-16 text-sm border border-gray-200 rounded px-2 py-1 text-center"
            />
            <span className="text-xs text-gray-400">%</span>
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-0.5 px-1">
          <span>50%</span>
          <span>90% (建議)</span>
          <span>100%</span>
        </div>
      </div>

      {/* Preview */}
      {(value.target_cpm || value.target_accuracy) && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-700">
          學生將看到目標：語速 {value.target_cpm ?? DEFAULT_TARGET_CPM} 字/分，
          正確率 {value.target_accuracy ?? DEFAULT_TARGET_ACCURACY}%
        </div>
      )}
    </div>
  );
};

export default ReadingGoalsForm;
