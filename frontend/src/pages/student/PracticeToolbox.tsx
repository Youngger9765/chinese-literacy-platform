/**
 * PracticeToolbox — student self-directed practice landing page.
 *
 * Route: /tools
 * Issue #1153
 *
 * Shows 6-8 practice tools grouped by category. Tools that require a
 * story (LiveTutor, ComprehensionChat) route to the library first so
 * students can pick a text before starting.
 *
 * "不用等作業，自己選想練的"
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Tool {
  icon: string;
  title: string;
  description: string;
  /** Route to navigate to. '#needs-story' = go to library first. */
  route: string;
  /** If true, button label changes to "選課文開始". */
  needsStory?: boolean;
}

interface ToolGroup {
  icon: string;
  label: string;
  tools: Tool[];
}

// ---------------------------------------------------------------------------
// Tool catalogue (curated, no smart recommendation)
// ---------------------------------------------------------------------------

const TOOL_GROUPS: ToolGroup[] = [
  {
    icon: '🗣️',
    label: '朗讀',
    tools: [
      {
        icon: '🎙️',
        title: '逐段朗讀',
        description: 'AI 即時指導，一段一段練好再往下',
        route: '/library',
        needsStory: true,
      },
      {
        icon: '📢',
        title: '全文朗讀',
        description: '完整朗讀一篇課文，聽自己的聲音',
        route: '/library',
        needsStory: true,
      },
    ],
  },
  {
    icon: '✍️',
    label: '寫字',
    tools: [
      {
        icon: '🖊️',
        title: '筆順字帖',
        description: '跟著動畫練正確筆順，不怕寫錯',
        route: '/write',
      },
      {
        icon: '🔤',
        title: '生字練習',
        description: '學習本課生字，注音+筆順一起來',
        route: '/library',
        needsStory: true,
      },
    ],
  },
  {
    icon: '👂',
    label: '聽寫',
    tools: [
      {
        icon: '🎧',
        title: '聽寫挑戰',
        description: 'AI 唸字，你來打字，邊聽邊學',
        route: '/library',
        needsStory: true,
      },
    ],
  },
  {
    icon: '📝',
    label: '字詞',
    tools: [
      {
        icon: '✏️',
        title: '造句練習',
        description: 'AI 出題，練習用學過的詞造好句子',
        route: '/library',
        needsStory: true,
      },
      {
        icon: '🔍',
        title: '詞語定義配對',
        description: '把詞語和它的意思配對，加深記憶',
        route: '/library',
        needsStory: true,
      },
      {
        icon: '📖',
        title: '字典查詢',
        description: '查字義、注音、例句，隨時查隨時懂',
        route: '/vocabulary',
      },
    ],
  },
  {
    icon: '🧠',
    label: '理解',
    tools: [
      {
        icon: '💬',
        title: '課文理解對話',
        description: '蘇格拉底式 AI 對話，深入理解課文',
        route: '/library',
        needsStory: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// ToolCard — single practice tool card
// ---------------------------------------------------------------------------

interface ToolCardProps {
  tool: Tool;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const navigate = useNavigate();

  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-all duration-200">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <span className="text-xl">{tool.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface leading-tight">{tool.title}</p>
          <p className="text-xs text-on-surface-variant mt-0.5 leading-snug">{tool.description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate(tool.route)}
        className="w-full py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent/90 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
      >
        {tool.needsStory ? '選課文開始' : '開始練習'}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ToolGroup section
// ---------------------------------------------------------------------------

interface ToolGroupSectionProps {
  group: ToolGroup;
}

const ToolGroupSection: React.FC<ToolGroupSectionProps> = ({ group }) => (
  <section aria-labelledby={`group-${group.label}`}>
    <h2
      id={`group-${group.label}`}
      className="flex items-center gap-2 text-sm font-bold text-on-surface-variant uppercase tracking-wide mb-3"
    >
      <span aria-hidden="true">{group.icon}</span>
      {group.label}
    </h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {group.tools.map((tool) => (
        <ToolCard key={tool.title} tool={tool} />
      ))}
    </div>
  </section>
);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PracticeToolbox: React.FC = () => {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold font-headline text-on-surface">
            練習工具箱
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            不用等作業，自己選想練的
          </p>
        </div>

        {/* Tool groups */}
        {TOOL_GROUPS.map((group) => (
          <ToolGroupSection key={group.label} group={group} />
        ))}

        {/* Footer note for story-required tools */}
        <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
          <p className="text-xs text-amber-700 leading-snug">
            <span className="font-bold">「選課文開始」</span> 的工具需要先選一篇課文才能練習。
            點選後會帶你到圖書館選課文，選完就直接進入練習。
          </p>
        </div>
      </div>
    </div>
  );
};

export default PracticeToolbox;
