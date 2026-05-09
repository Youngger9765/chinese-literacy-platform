/**
 * ToolPicker — right column of the /tools 練習工具箱 page.
 *
 * Renders a radio-select list of 10 practice tools.
 */
import React from 'react';

export interface ToolOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** Route segment under /learn/:storyId/ */
  stepPath: string;
}

// Order must match STEP_CONFIG in src/config/stepConfig.ts.
// If you reorder steps there, reorder this array to match.
// (Future: derive from STEP_CONFIG to avoid manual sync — see #1333)
export const TOOL_OPTIONS: ToolOption[] = [
  {
    id: 'tutor',
    label: '朗讀練習',
    description: '逐段朗讀，AI 即時糾正',
    icon: '🎤',
    stepPath: 'tutor',
  },
  {
    id: 'full-reading',
    label: '全文朗讀',
    description: '完整朗讀評估',
    icon: '📖',
    stepPath: 'full-reading',
  },
  {
    id: 'listening',
    label: '聽力理解',
    description: '聽 AI 朗讀，回答問題',
    icon: '👂',
    stepPath: 'listening',
  },
  {
    id: 'vocab',
    label: '生字書寫',
    description: '筆順練習 + 注音引導',
    icon: '🖊️',
    stepPath: 'vocab',
  },
  {
    id: 'sentence-practice',
    label: '造句練習',
    description: 'AI 引導造句，加深語感',
    icon: '✏️',
    stepPath: 'sentence-practice',
  },
  {
    id: 'vocab-definition',
    // Issue #1460: unify naming with stepConfig.ts ("詞語理解") — was "詞語配對"
    label: '詞語理解',
    description: '詞語與定義連連看',
    icon: '🔗',
    stepPath: 'vocab-definition',
  },
  {
    id: 'vocab-application',
    label: '詞語應用',
    description: '填空練習，活用詞語',
    icon: '📝',
    stepPath: 'vocab-application',
  },
  {
    id: 'comprehension',
    label: '課文理解',
    description: '蘇格拉底式 AI 對話',
    icon: '💬',
    stepPath: 'comprehension',
  },
  {
    id: 'vocab-word-search',
    label: '詞語搜尋',
    description: '在文章中找出目標詞語',
    icon: '🔍',
    stepPath: 'vocab-word-search',
  },
  {
    id: 'knowledge-station',
    label: '知識補給站',
    description: '延伸知識影片與補充',
    icon: '💡',
    stepPath: 'knowledge-station',
  },
];

interface ToolPickerProps {
  selectedId: string | null;
  onChange: (tool: ToolOption | null) => void;
}

const ToolPicker: React.FC<ToolPickerProps> = ({ selectedId, onChange }) => {
  const handleSelect = (tool: ToolOption) => {
    onChange(selectedId === tool.id ? null : tool);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-3">
        <h2 className="text-lg font-bold text-gray-900">選擇工具</h2>
        <p className="text-sm text-gray-500 mt-0.5">選一個練習方式</p>
      </div>

      {/* Tool list */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {TOOL_OPTIONS.map((tool) => {
          const isSelected = selectedId === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => handleSelect(tool)}
              aria-pressed={isSelected}
              className={`
                w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
                ${isSelected
                  ? 'bg-accent-bg border border-accent'
                  : 'bg-white border border-gray-100 hover:bg-gray-50 hover:border-gray-200'
                }
              `}
            >
              {/* Radio indicator */}
              <span
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isSelected ? 'border-accent' : 'border-gray-300'
                }`}
                aria-hidden="true"
              >
                {isSelected && (
                  <span className="w-2 h-2 rounded-full bg-accent" />
                )}
              </span>

              {/* Icon */}
              <span className="text-xl shrink-0" aria-hidden="true">{tool.icon}</span>

              {/* Label + desc */}
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium ${isSelected ? 'text-accent' : 'text-gray-800'}`}>
                  {tool.label}
                </span>
                <span className="block text-xs text-gray-400 mt-0.5">{tool.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ToolPicker;
