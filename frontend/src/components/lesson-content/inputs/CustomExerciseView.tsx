/**
 * CustomExerciseView — the `custom` escape hatch (grader 'manual', needsReview:true).
 *
 * Renders the prompt + optional renderHint + a free-form textarea to capture the raw
 * student text, plus a 「需人工檢核」 badge. It NEVER auto-passes: verdict stays null
 * and the exercise is excluded from allDone gating. The schema forces custom to carry
 * needsReview:true, so no "pretty but ungradable free string" can slip in as a pass.
 */
import React from 'react';

interface Props {
  prompt: string;
  renderHint?: string | null;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}

const CustomExerciseView: React.FC<Props> = ({ prompt, renderHint, value, onChange, disabled }) => (
  <div className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <p className="text-base font-medium text-on-surface whitespace-pre-wrap flex-1">{prompt}</p>
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-800">
        <span className="material-symbols-outlined text-sm" aria-hidden="true">flag</span>
        需人工檢核
      </span>
    </div>
    {renderHint ? (
      <p className="text-xs text-on-surface-variant/70 italic">{renderHint}</p>
    ) : null}
    <textarea
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      placeholder="在此寫下你的答案（此題由老師人工檢核）…"
      className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-base"
      aria-label="自由作答（需人工檢核）"
    />
  </div>
);

export default CustomExerciseView;
