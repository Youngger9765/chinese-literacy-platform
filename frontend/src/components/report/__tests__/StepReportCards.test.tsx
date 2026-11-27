/**
 * #3399 — 報告頁卡片 UI：完成打綠勾、點開看細節、未完成可前往。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StepReportCards from '../StepReportCards';
import type { StepReportCard } from '../reportCardsModel';

const cards: StepReportCard[] = [
  {
    stepId: 'full-text-annotate', baseId: 'full-text-annotate', label: '讀全文-做記號', icon: 'edit_note',
    completed: true, status: 'done', attempts: [], chart: null, rate: null, toFix: 0, fixed: 0, unit: '題', summary: '做了 2 個記號',
    details: [{ kind: 'marks', marks: [
      { type: 'unknown', text: '喝采', paragraphIndex: 0 },
      { type: 'important', text: '球后', paragraphIndex: 1 },
    ] }],
  },
  { stepId: 'vocab-review', baseId: 'vocab-review', label: '語詞複習', icon: 'search', completed: false, status: 'none', attempts: [], chart: null, rate: null, toFix: 0, fixed: 0, unit: '題', summary: null, details: [] },
];

describe('StepReportCards', () => {
  it('shows progress and a green check only on completed cards', () => {
    render(<StepReportCards storyTitle="贏得喝采的輸家" cards={cards} />);
    expect(screen.getByText('完成 1 / 2 關')).toBeInTheDocument();
    expect(screen.getAllByLabelText('已完成')).toHaveLength(1);
    expect(screen.getAllByLabelText('未完成')).toHaveLength(1);
  });

  it('opens details with the student marks', () => {
    render(<StepReportCards cards={cards} />);
    fireEvent.click(screen.getByRole('button', { name: /讀全文-做記號/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('喝采')).toBeInTheDocument();
    expect(within(dialog).getByText('球后')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the student go to an unfinished step', () => {
    const go = vi.fn();
    render(<StepReportCards cards={cards} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /^語詞複習：/ }));
    fireEvent.click(screen.getByRole('button', { name: '前往這一關' }));
    expect(go).toHaveBeenCalledWith('vocab-review');
  });

  // ── #4028：完成了但有錯題 → 黃色，可以回去訂正 ─────────────────────────────
  const withReview: StepReportCard[] = [
    cards[0],
    {
      stepId: 'comprehension', baseId: 'comprehension', label: '閱讀理解', icon: 'quiz',
      completed: true, status: 'review', attempts: [], chart: 'score', rate: 75, toFix: 1, fixed: 1, unit: '題', summary: '答對 3/4 題',
      details: [{ kind: 'answers', title: '作答紀錄', rows: [
        { label: '第 1 題', correct: false, studentAnswer: 'A', correctAnswer: 'B', corrected: true },
        { label: '第 2 題', correct: false, studentAnswer: 'C', correctAnswer: 'D', corrected: false },
      ] }],
    },
    cards[1],
  ];

  it('a completed step with mistakes counts as done but is yellow (#4028)', () => {
    render(<StepReportCards cards={withReview} />);
    expect(screen.getByText('完成 2 / 3 關')).toBeInTheDocument();
    expect(screen.getAllByLabelText('已完成')).toHaveLength(1);
    expect(screen.getAllByLabelText('已完成，有錯題要訂正')).toHaveLength(1);
    // 直接說哪一關、還有幾題，點了就過去（#4087）
    expect(screen.getByTestId('step-report-review-note')).toHaveTextContent('還有 1 關有錯題要訂正');
    expect(screen.getByTestId('to-fix-badge')).toHaveTextContent('還有 1 題要訂正');
  });

  it('the yellow card lists first-try misses with corrected / not yet, and offers to go back (#4028)', () => {
    const go = vi.fn();
    render(<StepReportCards cards={withReview} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /^閱讀理解：/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('還有 1 題要訂正')).toBeInTheDocument();
    expect(within(dialog).getByText('已訂正')).toBeInTheDocument();
    expect(within(dialog).getByText('還沒訂正')).toBeInTheDocument();
    expect(within(dialog).getByText('你第一次選：A')).toBeInTheDocument();
    expect(within(dialog).getByText('正確答案：B')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '回去訂正' }));
    expect(go).toHaveBeenCalledWith('comprehension');
  });

  it('a green card has no go-back button', () => {
    render(<StepReportCards cards={withReview} onGoToStep={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /讀全文-做記號/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /回去訂正|前往這一關/ })).toBeNull();
  });

  // ── #4087：歷次作答折線圖 + 點節點看那一次 ──────────────────────────────
  const withAttempts: StepReportCard = {
    stepId: 'comprehension', baseId: 'comprehension', label: '閱讀理解', icon: 'quiz',
    completed: true, status: 'done', chart: 'score', rate: 100, toFix: 0, fixed: 0, unit: '題', summary: '答對 4/4 題', details: [],
    attempts: [
      { id: 'a1', at: '2026-11-16T02:00:00Z', kind: 'first', correct: 2, total: 4,
        rows: [{ label: '第 1 題', correct: false, studentAnswer: '甲', correctAnswer: '乙' }] },
      { id: 'a2', at: '2026-11-16T02:10:00Z', kind: 'retry-wrong', correct: 4, total: 4,
        rows: [{ label: '第 1 題', correct: true }] },
    ],
  };

  it('a card answered more than once says so on its face (#4087)', () => {
    render(<StepReportCards cards={[withAttempts]} />);
    expect(screen.getByTestId('attempts-badge')).toHaveTextContent('作答 2 次');
  });

  it('opening it shows the attempts, guides to tap a point, and shows that attempt (#4087)', () => {
    render(<StepReportCards cards={[withAttempts]} />);
    fireEvent.click(screen.getByRole('button', { name: /閱讀理解/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/點折線上的點/)).toBeInTheDocument();
    expect(within(dialog).getByText('比第一次多對 2 題 🎉')).toBeInTheDocument();
    // 預設選最近一次
    expect(within(dialog).getByTestId('attempt-detail')).toHaveTextContent('第 2 次・訂正錯題');
    fireEvent.click(within(dialog).getByRole('button', { name: /第 1 次/ }));
    const detail = within(dialog).getByTestId('attempt-detail');
    expect(detail).toHaveTextContent('第 1 次・第一次作答');
    expect(detail).toHaveTextContent('答對 2/4');
    expect(detail).toHaveTextContent('你選：甲');
    expect(detail).toHaveTextContent('正確答案：乙');
  });

  it('a single attempt shows the result directly, no chart (#4087)', () => {
    render(<StepReportCards cards={[{ ...withAttempts, attempts: [withAttempts.attempts[0]] }]} />);
    expect(screen.queryByTestId('attempts-badge')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /閱讀理解/ }));
    expect(screen.queryByTestId('attempts-panel')).toBeNull();
  });

  it('shows the ability radar with strengths and weaknesses (#4087)', () => {
    const vocab: StepReportCard = { ...withAttempts, stepId: 'vocab-definition', baseId: 'vocab-definition', label: '詞語理解', rate: 50, attempts: [] };
    render(<StepReportCards cards={[withAttempts, vocab]} />);
    const radar = screen.getByTestId('report-radar');
    // 這兩張卡片只涵蓋詞語力、文意理解，其他三項是「本課無」
    expect(within(radar).getAllByText('本課無')).toHaveLength(3);
    expect(screen.getByTestId('report-radar-summary')).toHaveTextContent('強項：文意理解');
    expect(screen.getByTestId('report-radar-summary')).toHaveTextContent('需要加強：詞語力');
  });

  // ── #4162：跨課能力診斷只在傳入歷史資料時出現（老師端不傳，維持單課雷達）──
  it('有歷史資料：雷達加平均線、顯示矩陣；沒傳歷史：兩者都沒有 (#4162)', () => {
    const vocab: StepReportCard = { ...withAttempts, stepId: 'vocab-definition', baseId: 'vocab-definition', label: '詞語理解', rate: 50, attempts: [] };
    const mk = (n: number) => ({
      sessionId: n, storyId: `S${n}`, title: `第${n}課`,
      points: ['vocab', 'meaning', 'structure', 'strategy', 'fluency'].map((key, i) => ({
        key, label: ['詞語力', '文意理解', '結構統整', '閱讀策略', '朗讀流暢'][i], value: 70, state: 'scored' as const,
      })),
    });
    const { unmount } = render(
      <StepReportCards
        cards={[withAttempts, vocab]}
        abilityHistory={[mk(1), mk(2)]}
        currentLesson={{ storyId: 'CUR', sessionId: 99, title: '這課' }}
      />,
    );
    expect(screen.getByTestId('report-radar-legend')).toBeInTheDocument();
    expect(screen.getByTestId('ability-matrix')).toBeInTheDocument();
    unmount();
    // 歷史裡有同一課的舊紀錄：矩陣只出現一次這一課，而且是畫面上的即時分數
    const same = { ...mk(7), storyId: 'CUR', title: '同一課舊紀錄' };
    const { unmount: u2 } = render(
      <StepReportCards
        cards={[withAttempts, vocab]}
        abilityHistory={[mk(1), same]}
        currentLesson={{ storyId: 'CUR', sessionId: 99, title: '這課' }}
      />,
    );
    const matrix = screen.getByTestId('ability-matrix');
    expect(within(matrix).queryByText('同一課舊紀錄')).toBeNull();
    expect(within(matrix).getAllByText('這課')).toHaveLength(1);
    expect(matrix.querySelectorAll('thead th[title]')).toHaveLength(2);
    u2();
    // 老師端：有 currentLesson 的情況下也不傳歷史（null 與未傳）都不顯示
    render(<StepReportCards cards={[withAttempts, vocab]} abilityHistory={null} currentLesson={{ storyId: 'CUR', sessionId: 99 }} />);
    expect(screen.queryByTestId('report-radar-legend')).toBeNull();
    expect(screen.queryByTestId('ability-matrix')).toBeNull();
  });

  it('the top note lists each step still to fix and goes there (#4087)', () => {
    const go = vi.fn();
    render(<StepReportCards cards={withReview} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /閱讀理解・1 題 → 去訂正/ }));
    expect(go).toHaveBeenCalledWith('comprehension');
  });

  it('a step whose misses were all corrected is green and says how many (#4087)', () => {
    render(<StepReportCards cards={[{ ...cards[0], fixed: 2 }]} />);
    expect(screen.getByTestId('fixed-badge')).toHaveTextContent('訂正過 2 題');
    expect(screen.queryByTestId('step-report-review-note')).toBeNull();
  });
});
