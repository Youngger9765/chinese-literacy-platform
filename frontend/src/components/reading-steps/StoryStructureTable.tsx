/**
 * StoryStructureTable — 互動式文章重點表 (#615, #845, #1082, #2084)
 *
 * Fetches story structure from /api/stories/{id}/structure.
 * When API returns layout=worksheet_table, renders 紙本學習單 HTML table;
 * otherwise falls back to card layout (#2084).
 */
import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  STORY_STRUCTURE_INTERACTIVE_ATTR,
  DEMO_STEP_DURATION_MS,
  buildDemoSequence,
  deriveStructureProfile,
  getCoachIntroText,
  resolveDemoTargetElement,
  type StructureInteractionProfile,
} from './storyStructureProfile';

// ── Types ────────────────────────────────────────────────────────────────────

type InteractiveType = 'fill_blank' | 'checkbox' | 'display';

interface StructureSubRow {
  label: string;
  value: string;
  interactive_type: InteractiveType;
  hint?: string;
  blank_hints?: string[];
  blank_in_label?: boolean;
  options?: string[];
  correct_options?: number[];
}

interface StructureRow {
  label: string;
  value: string;
  interactive_type: InteractiveType;
  hint?: string;
  blank_hints?: string[];
  blank_in_label?: boolean;
  options?: string[];
  correct_options?: number[];
  sub_rows?: StructureSubRow[];
  blank_in_label?: boolean;
}

interface WorksheetPairRow {
  kind: 'pair';
  label: string;
  value: string;
}

interface WorksheetSectionBlockRow {
  kind: 'section_block';
  section: string;
  items: { label: string; value: string }[];
}

type WorksheetRow = WorksheetPairRow | WorksheetSectionBlockRow;

interface StructureData {
  layout?: 'worksheet_table' | 'cards';
  title?: string;
  worksheet_rows?: WorksheetRow[];
  rows: StructureRow[];
  interaction_profile?: Partial<StructureInteractionProfile>;
}

interface GradeResultItem {
  row_index: number;
  sub_row_index?: number;
  blank_index?: number;
  correct: boolean;
  feedback: string;
  correct_answer: string;
}

interface GradeResult {
  results: GradeResultItem[];
  score: number;
}

type AnswerMap = Record<string, string | number[]>;

interface Props {
  storyId: string;
  structure?: StructureData | null;
  previewMode?: boolean;
  showCoach?: boolean;
}

const INLINE_BLANK_RE = /【([^】]*)】/g;
const SECTION_CHUNK_SIZE = 3;
const STORY_STRUCTURE_ONBOARDED_KEY = 'story_structure_onboarded';

interface StoryStructureDemoRuntime {
  step: import('./storyStructureProfile').DemoStepId;
}

interface DemoSpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function padDemoRect(rect: DOMRect, padding = 10): DemoSpotlightRect {
  return {
    top: Math.max(8, rect.top - padding),
    left: Math.max(8, rect.left - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

interface DemoSpotlightOverlayProps {
  rect: DemoSpotlightRect;
  label: string;
  placement?: 'above' | 'below';
  bubbleAnchor?: 'top' | 'center' | 'bottom';
}

function DemoSpotlightOverlay({
  rect,
  label,
  placement = 'above',
  bubbleAnchor = 'center',
}: DemoSpotlightOverlayProps) {
  const { top, left, width, height } = rect;
  const bottom = top + height;
  const right = left + width;
  const anchorY =
    bubbleAnchor === 'top' ? top : bubbleAnchor === 'bottom' ? bottom : top + height / 2;

  const bubbleStyle: React.CSSProperties =
    placement === 'below'
      ? {
          top: anchorY + 14,
          left: left + width / 2,
          transform: 'translate(-50%, 0)',
        }
      : {
          top: anchorY - 14,
          left: left + width / 2,
          transform: 'translate(-50%, -100%)',
        };

  return createPortal(
    <div className="fixed inset-0 z-[220] pointer-events-none" role="presentation" aria-hidden>
      <div className="fixed left-0 right-0 top-0 bg-black/58 transition-opacity duration-700" style={{ height: top }} />
      <div className="fixed left-0 right-0 bg-black/58 transition-opacity duration-700" style={{ top: bottom, bottom: 0 }} />
      <div className="fixed bg-black/58 transition-opacity duration-700" style={{ top, left: 0, width: left, height }} />
      <div className="fixed bg-black/58 transition-opacity duration-700" style={{ top, left: right, right: 0, height }} />
      <div
        className="fixed rounded-xl ring-4 ring-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.25)] bg-white/5 transition-all duration-700 ease-in-out"
        style={{ top, left, width, height }}
      />
      <div
        className="fixed z-[221] transition-all duration-700 ease-in-out"
        style={bubbleStyle}
        role="status"
        aria-live="polite"
      >
        <div className="relative rounded-xl bg-accent text-white px-4 py-2.5 text-sm font-bold shadow-xl text-center max-w-xs animate-in fade-in zoom-in-95 duration-500">
          {label}
          <span
            className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-accent ${
              placement === 'below' ? '-top-1.5' : '-bottom-1.5'
            }`}
            aria-hidden
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface OnboardingCoachProps {
  introText: string;
  onDismiss: () => void;
  onDemo: () => void;
}

function OnboardingCoach({ introText, onDismiss, onDemo }: OnboardingCoachProps) {
  return (
    <div className="mb-4 rounded-2xl border-2 border-amber-400/60 bg-amber-50 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-500 text-2xl flex-shrink-0 mt-0.5">
          account_tree
        </span>
        <div className="flex-1">
          <p className="font-bold text-on-surface text-base mb-1">文章重點表怎麼玩？</p>
          <p className="text-sm text-on-surface-variant leading-relaxed">{introText}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-end">
        <button
          type="button"
          onClick={onDemo}
          className="px-4 py-2 rounded-full text-sm font-bold border-2 border-accent text-accent hover:bg-accent/10 active:scale-[0.98] transition-all"
        >
          示範
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-5 py-2 rounded-full text-sm font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}



// ── Helpers ──────────────────────────────────────────────────────────────────

function answerKey(rowIdx: number, subIdx?: number, blankIdx?: number): string {
  if (subIdx !== undefined && blankIdx !== undefined) {
    return `${rowIdx}-${subIdx}-b${blankIdx}`;
  }
  if (subIdx !== undefined) return `${rowIdx}-${subIdx}`;
  if (blankIdx !== undefined) return `${rowIdx}-b${blankIdx}`;
  return `${rowIdx}`;
}


function cellInteractiveText(cell: StructureRow | StructureSubRow): string {
  if ('blank_in_label' in cell && cell.blank_in_label) return cell.label;
  return cell.value;
}

function countBlanks(text: string): number {
  // 每次呼叫都用新鮮的 /g literal，避免共用單例 INLINE_BLANK_RE 的 lastIndex 殘留跨 cell 污染
  return text.match(/【[^】]*】/g)?.length ?? 0;
}

function classifyInteractive(value: string): InteractiveType {
  // 用不帶 /g 的 literal，.test() 不會推進 lastIndex（共用單例會有殘留狀態）
  return /【[^】]*】/.test(value) ? 'fill_blank' : 'display';
}

function resolveGradeIndex(
  rows: StructureRow[],
  wsRow: WorksheetRow,
  itemIdx?: number,
): { rowIdx: number; subIdx?: number } {
  if (wsRow.kind === 'pair') {
    const rowIdx = rows.findIndex(
      (r) => r.label === wsRow.label && !(r.sub_rows && r.sub_rows.length > 0),
    );
    return { rowIdx };
  }
  const rowIdx = rows.findIndex(
    (r) => r.label === wsRow.section && !!(r.sub_rows && r.sub_rows.length > 0),
  );
  return { rowIdx, subIdx: itemIdx };
}

function getLabelAccent(label: string): {
  borderClass: string;
  bgClass: string;
  textClass: string;
} {
  const PROBLEM_RE = /問題|困境|衝突|挑戰|難題|障礙/;
  const SOLUTION_RE = /解決|方法|策略|行動|回應|措施|處理|應對/;
  const RESULT_RE = /結果|影響|成效|成果|結局|後果|變化/;

  if (PROBLEM_RE.test(label)) {
    return {
      borderClass: 'border-l-4 border-amber-400',
      bgClass: 'bg-amber-50',
      textClass: 'text-amber-800',
    };
  }
  if (SOLUTION_RE.test(label)) {
    return {
      borderClass: 'border-l-4 border-sky-400',
      bgClass: 'bg-sky-50',
      textClass: 'text-sky-800',
    };
  }
  if (RESULT_RE.test(label)) {
    return {
      borderClass: 'border-l-4 border-emerald-400',
      bgClass: 'bg-emerald-50',
      textClass: 'text-emerald-800',
    };
  }
  return {
    borderClass: 'border-l-4 border-gray-300',
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-700',
  };
}

function findGradeItem(
  results: GradeResultItem[],
  rowIdx: number,
  subIdx?: number,
  blankIdx?: number,
): GradeResultItem | undefined {
  return results.find((r) => {
    if (r.row_index !== rowIdx || r.sub_row_index !== subIdx) return false;
    if (blankIdx !== undefined) return r.blank_index === blankIdx;
    return r.blank_index === undefined || r.blank_index === null;
  });
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sectionVerticalLabel(section: string): string {
  return section.replace(/\s+/g, '');
}

// ── Inline blank inputs (worksheet table cells) ─────────────────────────────

interface InlineBlankInputProps {
  value: string;
  onChange: (v: string) => void;
  submitted: boolean;
  gradeItem?: GradeResultItem;
  compact?: boolean;
}

const InlineBlankInput: React.FC<InlineBlankInputProps> = ({
  value,
  onChange,
  submitted,
  gradeItem,
  compact,
}) => {
  const width = compact ? 'w-16' : 'w-24';
  if (submitted && gradeItem) {
    const isCorrect = gradeItem.correct;
    return (
      <span
        className={`inline-block border-b-2 px-0.5 mx-0.5 text-sm ${
          isCorrect ? 'border-emerald-500 text-emerald-800' : 'border-red-500 text-red-800'
        }`}
        title={!isCorrect ? gradeItem.feedback : undefined}
      >
        {value || '　'}
      </span>
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="　"
      {...{ [STORY_STRUCTURE_INTERACTIVE_ATTR]: 'fill_blank' }}
      className={`${width} inline-block bg-transparent border-b-2 border-gray-800 text-sm text-center focus:outline-none focus:border-amber-600 mx-0.5`}
      disabled={submitted}
    />
  );
};

interface InlineWorksheetContentProps {
  text: string;
  rowIdx: number;
  subIdx?: number;
  answers: AnswerMap;
  setAnswer: (key: string, value: string | number[]) => void;
  submitted: boolean;
  gradeResults: GradeResultItem[];
}

const InlineWorksheetContent: React.FC<InlineWorksheetContentProps> = ({
  text,
  rowIdx,
  subIdx,
  answers,
  setAnswer,
  submitted,
  gradeResults,
}) => {
  const parts = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    let last = 0;
    let blankIdx = 0;
    const re = new RegExp(INLINE_BLANK_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) {
        nodes.push(<span key={`t-${last}`}>{text.slice(last, match.index)}</span>);
      }
      const key = answerKey(rowIdx, subIdx, blankIdx);
      nodes.push(
        <span key={`b-${blankIdx}`} className="inline-flex items-baseline">
          <span>【</span>
          <InlineBlankInput
            value={typeof answers[key] === 'string' ? (answers[key] as string) : ''}
            onChange={(v) => setAnswer(key, v)}
            submitted={submitted}
            gradeItem={
              submitted ? findGradeItem(gradeResults, rowIdx, subIdx, blankIdx) : undefined
            }
            compact
          />
          <span>】</span>
        </span>,
      );
      blankIdx += 1;
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      nodes.push(<span key={`t-${last}`}>{text.slice(last)}</span>);
    }
    return nodes;
  }, [text, rowIdx, subIdx, answers, setAnswer, submitted, gradeResults]);

  return <span className="text-sm leading-relaxed whitespace-pre-line">{parts}</span>;
};

// ── FillBlankCell (card layout) ─────────────────────────────────────────────

interface FillBlankCellProps {
  value: string;
  onChange: (v: string) => void;
  submitted: boolean;
  gradeItem?: GradeResultItem;
}

const FillBlankCell: React.FC<FillBlankCellProps> = ({
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
        placeholder="　"
        {...{ [STORY_STRUCTURE_INTERACTIVE_ATTR]: 'fill_blank' }}
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
    <div className="flex flex-col gap-2" {...{ [STORY_STRUCTURE_INTERACTIVE_ATTR]: 'checkbox' }}>
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

// ── Worksheet HTML table ─────────────────────────────────────────────────────

interface WorksheetTableProps {
  structure: StructureData;
  answers: AnswerMap;
  setAnswer: (key: string, value: string | number[]) => void;
  submitted: boolean;
  gradeResults: GradeResultItem[];
  renderCellContent: (
    cell: StructureRow | StructureSubRow,
    rowIdx: number,
    subIdx?: number,
  ) => React.ReactNode;
}

const WorksheetTable: React.FC<WorksheetTableProps> = ({
  structure,
  answers,
  setAnswer,
  submitted,
  gradeResults,
  renderCellContent,
}) => {
  const { title, worksheet_rows = [], rows } = structure;
  const cellBorder = 'border border-black px-2 py-2 align-top';

  const renderValueCell = (
    value: string,
    rowIdx: number,
    subIdx?: number,
  ) => {
    const itype = classifyInteractive(value);
    if (itype === 'fill_blank' && countBlanks(value) > 0) {
      return (
        <InlineWorksheetContent
          text={value}
          rowIdx={rowIdx}
          subIdx={subIdx}
          answers={answers}
          setAnswer={setAnswer}
          submitted={submitted}
          gradeResults={gradeResults}
        />
      );
    }
    if (rowIdx >= 0) {
      const cell = subIdx !== undefined ? rows[rowIdx]?.sub_rows?.[subIdx] : rows[rowIdx];
      if (cell) return renderCellContent(cell, rowIdx, subIdx);
    }
    return <span className="text-sm leading-relaxed whitespace-pre-line">{value}</span>;
  };

  return (
    <table className="w-full border-collapse border border-black text-sm bg-white">
      <tbody>
        {title && (
          <tr>
            <td
              colSpan={3}
              className={`${cellBorder} text-center font-bold text-base py-3`}
            >
              {title}
            </td>
          </tr>
        )}
        {worksheet_rows.map((wsRow, wsIdx) => {
          if (wsRow.kind === 'pair') {
            const { rowIdx } = resolveGradeIndex(rows, wsRow);
            const row = rows[rowIdx];
            return (
              <tr key={`pair-${wsIdx}`}>
                <td className={`${cellBorder} font-medium w-16 whitespace-pre-line`}>
                  {(row?.blank_in_label ||
                    classifyInteractive(wsRow.label) === 'fill_blank') &&
                  countBlanks(wsRow.label) > 0 ? (
                    <InlineWorksheetContent
                      text={wsRow.label}
                      rowIdx={rowIdx}
                      answers={answers}
                      setAnswer={setAnswer}
                      submitted={submitted}
                      gradeResults={gradeResults}
                    />
                  ) : (
                    wsRow.label
                  )}
                </td>
                <td colSpan={2} className={cellBorder}>
                  {renderValueCell(wsRow.value, rowIdx, undefined)}
                </td>
              </tr>
            );
          }

          const chunks = chunkItems(wsRow.items, SECTION_CHUNK_SIZE);
          return chunks.flatMap((chunk, chunkIdx) =>
            chunk.map((item, itemIdx) => {
              const globalItemIdx = chunkIdx * SECTION_CHUNK_SIZE + itemIdx;
              const { rowIdx, subIdx } = resolveGradeIndex(rows, wsRow, globalItemIdx);
              const subRow = rowIdx >= 0 ? rows[rowIdx]?.sub_rows?.[subIdx ?? 0] : undefined;
              const showSection = itemIdx === 0;
              const sectionLabel =
                chunkIdx === 0 ? sectionVerticalLabel(wsRow.section) : '';

              return (
                <tr key={`sec-${wsIdx}-${chunkIdx}-${itemIdx}`}>
                  {showSection && (
                    <td
                      rowSpan={chunk.length}
                      className={`${cellBorder} text-center font-medium w-10 align-middle ${
                        sectionLabel ? 'bg-white' : ''
                      }`}
                      style={
                        sectionLabel
                          ? { writingMode: 'vertical-rl', textOrientation: 'upright' }
                          : undefined
                      }
                    >
                      {sectionLabel}
                    </td>
                  )}
                  <td className={`${cellBorder} text-center font-medium w-20 whitespace-nowrap`}>
                    {item.label}
                  </td>
                  <td className={cellBorder}>
                    {renderValueCell(
                      item.value,
                      rowIdx,
                      subIdx,
                    )}
                  </td>
                </tr>
              );
            }),
          );
        })}
      </tbody>
    </table>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const StoryStructureTable: React.FC<Props> = ({
  storyId,
  structure: structureProp,
  previewMode = false,
  showCoach: showCoachProp,
}) => {
  const { token } = useAuth();
  const [structure, setStructure] = useState<StructureData | null>(structureProp ?? null);
  const [loading, setLoading] = useState(structureProp === undefined);
  const [fetchError, setFetchError] = useState(false);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [showCoach, setShowCoach] = useState<boolean>(() => {
    if (showCoachProp !== undefined) return showCoachProp;
    if (previewMode) return false;
    try {
      return !localStorage.getItem(STORY_STRUCTURE_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });
  const [demo, setDemo] = useState<StoryStructureDemoRuntime | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const [demoTargetRect, setDemoTargetRect] = useState<DemoSpotlightRect | null>(null);

  const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

  useEffect(() => {
    if (structureProp !== undefined) {
      setStructure(structureProp);
      setLoading(false);
      setFetchError(false);
      setAnswers({});
      setGradeResult(null);
      return;
    }
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
  }, [storyId, token, API_BASE, structureProp]);


  const clearDemoTimers = useCallback(() => {
    demoTimersRef.current.forEach((id) => clearTimeout(id));
    demoTimersRef.current = [];
  }, []);

  const scheduleDemoStep = useCallback((fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    demoTimersRef.current.push(id);
  }, []);

  useEffect(() => () => clearDemoTimers(), [clearDemoTimers]);

  const interactionProfile = useMemo(
    () => (structure ? deriveStructureProfile(structure) : null),
    [structure],
  );

  const demoSteps = useMemo(
    () => (interactionProfile ? buildDemoSequence(interactionProfile) : []),
    [interactionProfile],
  );

  const activeDemoStep = useMemo(
    () => (demo ? demoSteps.find((s) => s.id === demo.step) ?? null : null),
    [demo, demoSteps],
  );

  const resolveDemoTarget = useCallback((step: import('./storyStructureProfile').DemoStepId): HTMLElement | null => {
    return resolveDemoTargetElement(
      step,
      tableContainerRef.current,
      submitBtnRef.current,
    );
  }, []);

  useLayoutEffect(() => {
    if (!demo) {
      setDemoTargetRect(null);
      return;
    }

    const measure = () => {
      const el = resolveDemoTarget(demo.step);
      setDemoTargetRect(el ? padDemoRect(el.getBoundingClientRect()) : null);
    };

    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [demo, resolveDemoTarget, structure, loading]);

  const handleDismissCoach = useCallback(() => {
    setShowCoach(false);
    try {
      localStorage.setItem(STORY_STRUCTURE_ONBOARDED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const handleDemo = useCallback(() => {
    if (!interactionProfile || demoSteps.length === 0) return;
    clearDemoTimers();
    handleDismissCoach();
    demoSteps.forEach((stepConfig, index) => {
      scheduleDemoStep(() => setDemo({ step: stepConfig.id }), index * DEMO_STEP_DURATION_MS);
    });
    scheduleDemoStep(() => setDemo(null), demoSteps.length * DEMO_STEP_DURATION_MS);
  }, [
    clearDemoTimers,
    handleDismissCoach,
    scheduleDemoStep,
    interactionProfile,
    demoSteps,
  ]);


  const setAnswer = useCallback((key: string, value: string | number[]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const pushFillBlankAnswers = useCallback(
    (
      payload: object[],
      rowIdx: number,
      subIdx: number | undefined,
      cell: StructureRow | StructureSubRow,
    ) => {
      const blankCount =
        cell.blank_hints?.length ||
        (cell.interactive_type === 'fill_blank' ? Math.max(countBlanks(cellInteractiveText(cell)), 1) : 0);
      if (blankCount <= 1) {
        const key = answerKey(rowIdx, subIdx);
        payload.push({
          row_index: rowIdx,
          ...(subIdx !== undefined ? { sub_row_index: subIdx } : {}),
          value: typeof answers[key] === 'string' ? answers[key] : '',
        });
        return;
      }
      for (let b = 0; b < blankCount; b += 1) {
        const key = answerKey(rowIdx, subIdx, b);
        payload.push({
          row_index: rowIdx,
          ...(subIdx !== undefined ? { sub_row_index: subIdx } : {}),
          blank_index: b,
          value: typeof answers[key] === 'string' ? answers[key] : '',
        });
      }
    },
    [answers],
  );

  const buildAnswerPayload = useCallback((): object[] => {
    if (!structure) return [];
    const payload: object[] = [];

    structure.rows.forEach((row, rowIdx) => {
      if (row.sub_rows && row.sub_rows.length > 0) {
        row.sub_rows.forEach((sub, subIdx) => {
          if (sub.interactive_type === 'display') return;
          if (sub.interactive_type === 'checkbox') {
            const key = answerKey(rowIdx, subIdx);
            payload.push({
              row_index: rowIdx,
              sub_row_index: subIdx,
              selected_options: Array.isArray(answers[key]) ? answers[key] : [],
            });
          } else {
            pushFillBlankAnswers(payload, rowIdx, subIdx, sub);
          }
        });
      } else {
        if (row.interactive_type === 'display') return;
        if (row.interactive_type === 'checkbox') {
          const key = answerKey(rowIdx);
          payload.push({
            row_index: rowIdx,
            selected_options: Array.isArray(answers[key]) ? answers[key] : [],
          });
        } else {
          pushFillBlankAnswers(payload, rowIdx, undefined, row);
        }
      }
    });

    return payload;
  }, [structure, answers, pushFillBlankAnswers]);

  const handleCopyTemplate = useCallback(() => {
    if (!structure) return;
    const lines: string[] = ['【文章重點表模板】', ''];
    if (structure.title) lines.push(structure.title, '');

    if (structure.layout === 'worksheet_table' && structure.worksheet_rows) {
      structure.worksheet_rows.forEach((wsRow) => {
        if (wsRow.kind === 'pair') {
          lines.push(`${wsRow.label}：${wsRow.value.replace(INLINE_BLANK_RE, '【　　　】')}`);
        } else {
          lines.push(`【${wsRow.section}】`);
          wsRow.items.forEach((item) => {
            lines.push(
              `  ${item.label}：${item.value.replace(INLINE_BLANK_RE, '【　　　】')}`,
            );
          });
        }
        lines.push('');
      });
    } else {
      structure.rows.forEach((row) => {
        if (row.sub_rows && row.sub_rows.length > 0) {
          lines.push(`【${row.label}】`);
          row.sub_rows.forEach((sub) => {
            lines.push(`  上位概念：${sub.label}`);
            lines.push(
              sub.interactive_type === 'display' && sub.value?.trim()
                ? `  重點：${sub.value}`
                : '  重點：________________',
            );
            lines.push('');
          });
        } else {
          lines.push(`上位概念：${row.label}`);
          lines.push(
            row.interactive_type === 'display' && row.value?.trim()
              ? `重點：${row.value}`
              : '重點：________________',
          );
          lines.push('');
        }
      });
    }

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1500);
    }).catch(() => {});
  }, [structure]);

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

  const countInteractiveFields = useCallback(
    (cell: StructureRow | StructureSubRow): number => {
      if (cell.interactive_type === 'display') return 0;
      if (cell.interactive_type === 'checkbox') return 1;
      const blanks = cell.blank_hints?.length || countBlanks(cellInteractiveText(cell));
      return blanks > 0 ? blanks : 1;
    },
    [],
  );

  const { totalInteractive, totalAnswered } = useMemo(() => {
    if (!structure) return { totalInteractive: 0, totalAnswered: 0 };
    let total = 0;
    let answered = 0;

    const tallyCell = (
      cell: StructureRow | StructureSubRow,
      rowIdx: number,
      subIdx?: number,
    ) => {
      const fieldCount = countInteractiveFields(cell);
      if (fieldCount === 0) return;

      if (cell.interactive_type === 'checkbox') {
        total += 1;
        const key = answerKey(rowIdx, subIdx);
        const val = answers[key];
        if (Array.isArray(val) && val.length > 0) answered += 1;
        return;
      }

      const blankCount =
        cell.blank_hints?.length ||
        (cell.interactive_type === 'fill_blank' ? Math.max(countBlanks(cellInteractiveText(cell)), 1) : 1);
      total += blankCount;
      for (let b = 0; b < blankCount; b += 1) {
        const key = answerKey(rowIdx, subIdx, blankCount > 1 ? b : undefined);
        const val = answers[key];
        if (typeof val === 'string' && val.trim().length > 0) answered += 1;
      }
    };

    structure.rows.forEach((row, rowIdx) => {
      if (row.sub_rows?.length) {
        row.sub_rows.forEach((sub, subIdx) => tallyCell(sub, rowIdx, subIdx));
      } else {
        tallyCell(row, rowIdx);
      }
    });

    return { totalInteractive: total, totalAnswered: answered };
  }, [structure, answers, countInteractiveFields]);

  const allAnswered = totalAnswered >= totalInteractive && totalInteractive > 0;
  const submitted = gradeResult !== null;
  const gradeResults = gradeResult?.results ?? [];
  const score = gradeResult?.score ?? 0;

  const renderCellContent = useCallback(
    (
      cell: StructureRow | StructureSubRow,
      rowIdx: number,
      subIdx?: number,
    ) => {
      if (cell.interactive_type === 'display') {
        return (
          <span className="text-base italic text-gray-800 leading-relaxed font-medium">
            {cell.value}
          </span>
        );
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
          value={typeof answers[key] === 'string' ? (answers[key] as string) : ''}
          onChange={(v) => setAnswer(key, v)}
          submitted={submitted}
          gradeItem={gradeItem}
        />
      );
    },
    [answers, submitted, gradeResults, setAnswer],
  );

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
  const useWorksheet =
    structure.layout === 'worksheet_table' &&
    !!(structure.worksheet_rows && structure.worksheet_rows.length > 0);

  const coachIntroText = interactionProfile
    ? getCoachIntroText(interactionProfile)
    : '讀課文，完成表格練習';

  return (
    <div className={useWorksheet ? 'max-w-3xl mx-auto' : 'max-w-2xl mx-auto'}>
      {showCoach && (
        <OnboardingCoach
          introText={coachIntroText}
          onDismiss={handleDismissCoach}
          onDemo={handleDemo}
        />
      )}
      {!showCoach && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setShowCoach(true)}
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">help_outline</span>
            怎麼玩？
          </button>
        </div>
      )}
      {demo && demoTargetRect && activeDemoStep && (
        <DemoSpotlightOverlay
          rect={demoTargetRect}
          label={activeDemoStep.bubbleText}
          placement={activeDemoStep.placement}
          bubbleAnchor={activeDemoStep.bubbleAnchor}
        />
      )}
    <div
      ref={tableContainerRef}
      data-story-structure-table
      className="overflow-hidden rounded-xl border-2 border-gray-300 shadow-sm"
    >
      <div className="bg-amber-50 border-b-2 border-amber-400 px-5 py-3 flex items-center justify-between gap-2">
        <span className="text-amber-800 font-bold text-base">📋 文章重點表</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyTemplate}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-700 text-xs font-semibold hover:bg-amber-100 active:scale-95 transition-all select-none"
            title="複製模板到剪貼板"
          >
            <span className="material-symbols-outlined text-sm" style={{ fontSize: '14px' }}>
              {copyDone ? 'check_circle' : 'content_copy'}
            </span>
            {copyDone ? '已複製 ✓' : '複製模板'}
          </button>
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
      </div>

      {useWorksheet ? (
        <div className="p-3 bg-white overflow-x-auto">
          <WorksheetTable
            structure={structure}
            answers={answers}
            setAnswer={setAnswer}
            submitted={submitted}
            gradeResults={gradeResults}
            renderCellContent={renderCellContent}
          />
        </div>
      ) : (
        <div className="divide-y-2 divide-gray-200 text-base">
          {rows.map((row, rowIdx) => {
            const hasSubRows = !!(row.sub_rows && row.sub_rows.length > 0);
            const topLevelEmptyDisplay =
              !hasSubRows && row.interactive_type === 'display' && !row.value?.trim();
            const accent = getLabelAccent(row.label);

            return (
              <section key={`${rowIdx}-${row.label}`}>
                <div
                  className={`${accent.borderClass} ${accent.bgClass} px-4 py-2.5 font-bold ${accent.textClass} leading-snug`}
                >
                  {row.label}
                </div>

                {hasSubRows ? (
                  <div className="divide-y divide-gray-100 ml-6 border-l-2 border-gray-200">
                    {(row.sub_rows ?? []).map((sub, subIdx) => {
                      const subAccent = getLabelAccent(sub.label);
                      return (
                        <div key={`${subIdx}-${sub.label}`}>
                          <div
                            className={`${subAccent.borderClass} ${subAccent.bgClass} px-4 py-2 text-sm font-semibold ${subAccent.textClass} leading-snug`}
                          >
                            {sub.label}
                          </div>
                          <div className="px-4 py-3">
                            {renderCellContent(sub, rowIdx, subIdx)}
                          </div>
                        </div>
                      );
                    })}
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
      )}

      <div className="px-5 py-4 border-t-2 border-gray-200 bg-gray-50">
        {!previewMode && !submitted ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              已填 {totalAnswered} / {totalInteractive} 題
            </p>
            <button
              ref={submitBtnRef}
              data-story-structure-submit
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
        ) : !previewMode && score < 0 ? (
          <p className="text-sm text-red-500 text-center">
            批改失敗，請重新整理後再試
          </p>
        ) : !previewMode ? (
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
        ) : null}
      </div>
    </div>
    </div>
  );
};

export default StoryStructureTable;
