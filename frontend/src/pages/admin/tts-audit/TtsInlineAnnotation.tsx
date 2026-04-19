// TtsInlineAnnotation.tsx — inline diff annotation for TTS replacements (Issue #1120)
import React from 'react';
import type { Replacement } from './types';

interface Props {
  raw: string;
  replacements: Replacement[];
  /** true = compact (list row), false = full (side panel) */
  compact?: boolean;
}

interface Segment {
  text: string;
  replacement?: Replacement;
}

function buildSegments(raw: string, replacements: Replacement[]): Segment[] {
  if (replacements.length === 0) return [{ text: raw }];

  const segments: Segment[] = [];
  let remaining = raw;

  for (const r of replacements) {
    const idx = remaining.indexOf(r.from);
    if (idx === -1) continue;
    if (idx > 0) segments.push({ text: remaining.slice(0, idx) });
    segments.push({ text: r.from, replacement: r });
    remaining = remaining.slice(idx + r.from.length);
  }
  if (remaining) segments.push({ text: remaining });
  if (segments.length === 0) return [{ text: raw }];
  return segments;
}

/**
 * Renders raw_text with inline annotations for each replacement.
 *
 * Compact (list row):
 *   她的[攻擊]千變萬化...   (orange underline, no tooltip expansion)
 *
 * Full (side panel):
 *   她的[攻擊 → 攻急 (台灣發音)]千變萬化...
 */
export const TtsInlineAnnotation: React.FC<Props> = ({ raw, replacements, compact = false }) => {
  const segments = buildSegments(raw, replacements);

  return (
    <span className="leading-relaxed">
      {segments.map((seg, i) => {
        if (!seg.replacement) {
          return <span key={i} className="text-gray-700">{seg.text}</span>;
        }
        const r = seg.replacement;
        if (compact) {
          return (
            <span
              key={i}
              className="text-orange-700 underline decoration-dotted decoration-orange-400 cursor-default"
              title={`→ ${r.to} (${r.rule})`}
            >
              {seg.text}
            </span>
          );
        }
        // Full mode: show arrow + label inline
        return (
          <span key={i} className="inline-flex flex-col items-start mr-0.5 align-bottom">
            <span className="bg-orange-50 border border-orange-200 rounded px-0.5 text-orange-800 font-medium leading-tight">
              {seg.text}
            </span>
            <span className="flex items-center gap-0.5 text-[10px] text-orange-500 leading-none mt-0.5 whitespace-nowrap">
              <span>↓</span>
              <span className="text-orange-700 font-medium">{r.to}</span>
              <span className="text-gray-400">({r.rule})</span>
            </span>
          </span>
        );
      })}
    </span>
  );
};
