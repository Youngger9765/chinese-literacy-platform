import React from 'react';
import { DiffToken } from '../../types';

interface DiffDisplayProps {
  tokens: DiffToken[];
  showLegend?: boolean;
  className?: string;
}

/**
 * Renders character-level diff tokens with color-coded highlighting.
 *
 * Rendering rules:
 * - correct → normal text (inherit color)
 * - wrong   → red background + white text, tooltip shows expected char
 * - missing → gray background + dashed underline (shows target char that was skipped)
 * - extra   → orange background + strikethrough (shows char that shouldn't be there)
 */
const DiffDisplay: React.FC<DiffDisplayProps> = ({ tokens, showLegend = false, className = '' }) => {
  if (!tokens || tokens.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap leading-relaxed text-lg">
        {tokens.map((token, idx) => {
          switch (token.type) {
            case 'correct':
              return (
                <span key={idx} className="text-gray-900">
                  {token.char}
                </span>
              );
            case 'wrong':
              return (
                <span
                  key={idx}
                  className="bg-error text-white rounded-sm px-0.5 mx-px cursor-help relative group"
                  title={`應該是「${token.expected}」`}
                >
                  {token.char}
                  {token.expected && (
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      應該是「{token.expected}」
                    </span>
                  )}
                </span>
              );
            case 'missing':
              return (
                <span
                  key={idx}
                  className="bg-gray-200 text-gray-400 border-b-2 border-dashed border-gray-400 rounded-sm px-0.5 mx-px"
                  title="漏讀"
                >
                  {token.char}
                </span>
              );
            case 'extra':
              return (
                <span
                  key={idx}
                  className="bg-warning/30 text-warning line-through rounded-sm px-0.5 mx-px"
                  title="多讀"
                >
                  {token.char}
                </span>
              );
            default:
              return <span key={idx}>{token.char}</span>;
          }
        })}
      </div>

      {showLegend && (
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-gray-900 inline-block" />
            正確
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-error inline-block" />
            讀錯
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-gray-200 border border-dashed border-gray-400 inline-block" />
            漏讀
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-warning/30 inline-block" />
            多讀
          </span>
        </div>
      )}
    </div>
  );
};

export default DiffDisplay;
