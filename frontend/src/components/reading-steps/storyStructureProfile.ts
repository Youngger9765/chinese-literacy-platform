/**
 * Story structure interaction profile + demo sequence builder.
 *
 * Contract:
 * - Backend attaches `interaction_profile` on GET /structure (preferred).
 * - Frontend can derive the same shape from `rows` when missing (AI fallback).
 * - Demo/coach read profile only — new table YAML formats extend rows, not demo code.
 */

export const STORY_STRUCTURE_DOM = {
  LESSON_TEXT: '[data-comprehension-lesson-text]',
  TABLE: '[data-story-structure-table]',
  FIRST_INTERACTIVE: '[data-story-structure-interactive]',
  SUBMIT: '[data-story-structure-submit]',
} as const;

export const STORY_STRUCTURE_INTERACTIVE_ATTR = 'data-story-structure-interactive';

export type StructureInteractionMode =
  | 'fill_blank'
  | 'checkbox'
  | 'mixed'
  | 'display_only';

export type StructureTemplateKind =
  | 'psr'
  | 'theme_facts'
  | 'scientific'
  | 'generic';

export interface StructureInteractionProfile {
  mode: StructureInteractionMode;
  template_kind: StructureTemplateKind;
  fill_blank_count: number;
  checkbox_count: number;
  primary_labels: string[];
  layout: 'worksheet_table' | 'cards';
}

export type DemoStepId = 'overview' | 'read' | 'interact' | 'submit' | 'feedback';

export interface DemoStepConfig {
  id: DemoStepId;
  bubbleText: string;
  placement: 'above' | 'below';
  bubbleAnchor: 'top' | 'center' | 'bottom';
}

export const DEMO_STEP_DURATION_MS = 2800;

interface StructureRowLike {
  label: string;
  value?: string;
  interactive_type?: string;
  sub_rows?: StructureRowLike[];
}

interface StructureDataLike {
  title?: string;
  layout?: 'worksheet_table' | 'cards';
  rows: StructureRowLike[];
  interaction_profile?: Partial<StructureInteractionProfile>;
}

const TEMPLATE_KINDS: StructureTemplateKind[] = [
  'psr',
  'theme_facts',
  'scientific',
  'generic',
];

const INTERACTION_MODES: StructureInteractionMode[] = [
  'fill_blank',
  'checkbox',
  'mixed',
  'display_only',
];

function inferTemplateKind(title: string | undefined, labels: string[]): StructureTemplateKind {
  const blob = [title ?? '', ...labels].join(' ');
  if (/假說|驗證|步驟|探究/.test(blob)) return 'scientific';
  if (/問題/.test(blob) && /解決|結果|影響|成效/.test(blob)) return 'psr';
  if (/主題|事實|主角|事例|論點/.test(blob)) return 'theme_facts';
  return 'generic';
}

export function deriveStructureProfile(structure: StructureDataLike): StructureInteractionProfile {
  const api = structure.interaction_profile;
  if (
    api?.mode &&
    INTERACTION_MODES.includes(api.mode as StructureInteractionMode) &&
    api.template_kind &&
    TEMPLATE_KINDS.includes(api.template_kind as StructureTemplateKind)
  ) {
    return {
      mode: api.mode as StructureInteractionMode,
      template_kind: api.template_kind as StructureTemplateKind,
      fill_blank_count: api.fill_blank_count ?? 0,
      checkbox_count: api.checkbox_count ?? 0,
      primary_labels: api.primary_labels ?? [],
      layout:
        api.layout === 'worksheet_table' || structure.layout === 'worksheet_table'
          ? 'worksheet_table'
          : 'cards',
    };
  }

  let fillBlankCount = 0;
  let checkboxCount = 0;
  const primaryLabels: string[] = [];
  const sectionLabels: string[] = [];

  const tally = (row: StructureRowLike) => {
    const label = row.label?.trim() ?? '';
    if (row.interactive_type === 'fill_blank') {
      fillBlankCount += 1;
      if (label) primaryLabels.push(label);
    } else if (row.interactive_type === 'checkbox') {
      checkboxCount += 1;
      if (label) primaryLabels.push(label);
    }
  };

  structure.rows.forEach((row) => {
    const parentLabel = row.label?.trim() ?? '';
    if (parentLabel) sectionLabels.push(parentLabel);
    if (row.sub_rows?.length) {
      row.sub_rows.forEach(tally);
    } else {
      tally(row);
    }
  });

  let mode: StructureInteractionMode;
  if (fillBlankCount && checkboxCount) mode = 'mixed';
  else if (fillBlankCount) mode = 'fill_blank';
  else if (checkboxCount) mode = 'checkbox';
  else mode = 'display_only';

  return {
    mode,
    template_kind: inferTemplateKind(structure.title, [...primaryLabels, ...sectionLabels]),
    fill_blank_count: fillBlankCount,
    checkbox_count: checkboxCount,
    primary_labels: primaryLabels.slice(0, 4),
    layout: structure.layout === 'worksheet_table' ? 'worksheet_table' : 'cards',
  };
}

function overviewText(profile: StructureInteractionProfile): string {
  switch (profile.template_kind) {
    case 'psr':
      return '① 這張表幫你整理課文的問題、解決、結果';
    case 'scientific':
      return '① 這張表帶你走科學探究：問題、假說、驗證、結論';
    case 'theme_facts':
      return '① 用表格整理課文的主題與重要事實';
    case 'generic':
    default:
      return profile.mode === 'display_only'
        ? '① 對照表格，整理課文的關鍵重點'
        : '① 這張表幫你整理課文重點';
  }
}

function readText(profile: StructureInteractionProfile): string {
  if (profile.mode === 'display_only') {
    return '② 讀課文，對照表格裡的整理';
  }
  if (profile.mode === 'checkbox') {
    return '② 讀課文，想想哪些選項符合文章重點';
  }
  return '② 讀課文，想想空格要填什麼關鍵詞';
}

function interactText(profile: StructureInteractionProfile): string {
  if (profile.mode === 'checkbox') {
    return '③ 勾選符合課文的重點選項';
  }
  if (profile.mode === 'mixed') {
    return '③ 填空或勾選符合課文的答案';
  }
  return '③ 點【　】空格，輸入你的答案';
}

export function buildDemoSequence(profile: StructureInteractionProfile): DemoStepConfig[] {
  const steps: DemoStepConfig[] = [
    {
      id: 'overview',
      bubbleText: overviewText(profile),
      placement: 'below',
      bubbleAnchor: 'top',
    },
    {
      id: 'read',
      bubbleText: readText(profile),
      placement: 'below',
      bubbleAnchor: 'top',
    },
  ];

  if (profile.mode !== 'display_only') {
    steps.push(
      {
        id: 'interact',
        bubbleText: interactText(profile),
        placement: 'above',
        bubbleAnchor: 'center',
      },
      {
        id: 'submit',
        bubbleText: '④ 全部完成後，按「提交答案」',
        placement: 'above',
        bubbleAnchor: 'center',
      },
      {
        id: 'feedback',
        bubbleText: '⑤ AI 會幫你檢查，答錯可以看參考提示',
        placement: 'above',
        bubbleAnchor: 'center',
      },
    );
  }

  return steps;
}

export function getCoachIntroText(profile: StructureInteractionProfile): string {
  const templateLine = (() => {
    switch (profile.template_kind) {
      case 'psr':
        return '問題、解決、結果';
      case 'scientific':
        return '問題、假說、驗證、結論';
      case 'theme_facts':
        return '主題與重要事實';
      default:
        return '課文重點';
    }
  })();

  if (profile.mode === 'display_only') {
    return `對照課文閱讀這張表，整理「${templateLine}」等關鍵資訊`;
  }
  if (profile.mode === 'checkbox') {
    return `用表格整理課文的${templateLine}。讀課文後勾選符合的重點，填完按「提交答案」，AI 會幫你檢查`;
  }
  if (profile.mode === 'mixed') {
    return `用表格整理課文的${templateLine}。讀課文後填空或勾選答案，填完按「提交答案」，AI 會幫你檢查`;
  }
  return `用表格整理課文的${templateLine}。讀課文，把關鍵詞填進【　】空格，填完按「提交答案」，AI 會幫你檢查`;
}

export function resolveDemoTargetElement(
  stepId: DemoStepId,
  tableContainer: HTMLElement | null,
  submitButton: HTMLElement | null,
): HTMLElement | null {
  switch (stepId) {
    case 'overview':
      return tableContainer;
    case 'read':
      return document.querySelector(STORY_STRUCTURE_DOM.LESSON_TEXT);
    case 'interact':
      return (
        tableContainer?.querySelector(STORY_STRUCTURE_DOM.FIRST_INTERACTIVE) ??
        tableContainer
      );
    case 'submit':
    case 'feedback':
      return submitButton ?? tableContainer;
    default:
      return tableContainer;
  }
}
