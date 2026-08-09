/**
 * readingDiffStyle — single source of truth for student-facing 朗讀結果 diff colors
 * and the accompanying legend (Issue #2498).
 *
 * Before this file, ParagraphCard (逐段) and KeyPassageReadingFeedbackPanel (全文) each
 * hard-coded the same color mapping, and the blue `forgiven` (同音通融) color had no
 * legend entry at all — students saw blue characters with no explanation.
 *
 * The teacher-facing DiffDisplay.tsx keeps its own (different) palette on purpose;
 * this module only governs the two student inline panels so they stay in sync.
 */

import React from 'react';
import { DiffToken } from '../../types';

/** Tailwind classes for each diff token type in the student inline panels. */
export function diffTokenClassName(type: DiffToken['type']): string {
  return type === 'punctuation' ? 'text-on-surface' :
    type === 'correct' ? 'text-emerald-600 font-medium' :
    type === 'forgiven' ? 'text-blue-500 font-medium' :
    type === 'wrong' ? 'text-tertiary line-through' :
    type === 'missing' || type === 'unread' ? 'text-on-surface-variant/30' :
    'text-on-surface';
}

/** Render diff tokens as colored <span>s. */
export function renderDiffTokenSpans(tokens: DiffToken[], keyPrefix: string) {
  return tokens.map((t, i) => (
    <span key={`${keyPrefix}-${i}`} className={diffTokenClassName(t.type)}>
      {t.char}
    </span>
  ));
}

/** Legend rows — keep in sync with diffTokenClassName above. */
const LEGEND_ITEMS: { dotClass: string; label: string }[] = [
  { dotClass: 'text-emerald-600', label: '正確' },
  { dotClass: 'text-blue-500', label: '通融（同音／讀音相近）' },
  { dotClass: 'text-tertiary', label: '唸錯' },
  { dotClass: 'text-on-surface-variant/40', label: '漏念' },
];

/**
 * 朗讀對照色碼圖例 — shared by 逐段 (ParagraphCard) and 全文 (KeyPassageReadingFeedbackPanel).
 * `title` defaults to 朗讀對照; pass a custom label or null to omit.
 */
export const ReadingDiffLegend: React.FC<{ title?: string | null }> = ({ title = '朗讀對照' }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
    {title && (
      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">{title}</span>
    )}
    {LEGEND_ITEMS.map(({ dotClass, label }) => (
      <span key={label} className="flex items-center gap-1 text-xs text-on-surface-variant">
        <span className={`${dotClass} font-bold`}>●</span> {label}
      </span>
    ))}
  </div>
);
