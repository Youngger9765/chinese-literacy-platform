/**
 * #3780 第三階段：老師端三個畫面（ability-indicators.md §5）
 *   ① 班級 × 能力指標熱力表 ② 單一學生能力清單 ③ 哪幾課、哪幾題撐起這個判斷
 * 鎖：固定顯示「課綱對照為草稿，待老師審核」；不出現「學習扶助」欄。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'tok' }) }));

const heatmapMock = vi.fn();
const detailMock = vi.fn();
vi.mock('../../../services/teacherReadingBabyApi', () => ({
  fetchClassroomIndicatorHeatmap: (...a: unknown[]) => heatmapMock(...a),
  fetchIndicatorEvidenceDetail: (...a: unknown[]) => detailMock(...a),
}));

import ReadingBabyIndicatorsPanel from './ReadingBabyIndicatorsPanel';

const HEATMAP = {
  classroom_id: 7,
  indicator_codes: ['5-Ⅲ-6', '5-Ⅲ-8'],
  student_ids: [11, 12],
  students: [
    { student_id: 11, name: '王小明' },
    { student_id: 12, name: '李小華' },
  ],
  indicators: [
    { code: '5-Ⅲ-6', text: '熟習適合學習階段的摘要策略，擷取大意。' },
    { code: '5-Ⅲ-8', text: '運用自我提問、推論等策略，推論文本隱含的因果訊息或觀點。' },
  ],
  cells: [
    { student_id: 11, indicator_code: '5-Ⅲ-6', status: 'achieved', passed_lesson_count: 1, total_items: 5 },
    { student_id: 11, indicator_code: '5-Ⅲ-8', status: 'transferable', passed_lesson_count: 2, total_items: 9 },
    { student_id: 12, indicator_code: '5-Ⅲ-6', status: 'not_achieved', passed_lesson_count: 0, total_items: 6 },
    { student_id: 12, indicator_code: '5-Ⅲ-8', status: 'not_assigned', passed_lesson_count: 0, total_items: 0 },
  ],
  note: '課綱對照為草稿，待老師審核',
};

const DETAIL = {
  student_id: 12,
  student_name: '李小華',
  indicator_code: '5-Ⅲ-6',
  indicator_text: '熟習適合學習階段的摘要策略，擷取大意。',
  note: '課綱對照為草稿，待老師審核',
  evidence: [
    {
      lesson_uid: 'L0042', lesson_title: '大象的旅行', station: 'spotlight', station_label: '聚光閣',
      quality_passed: false, quality_score: 0.33, items_total: 3, items_first_try_correct: 1,
      cpm: null, accuracy: null,
      source_ref: { session_id: 5, raw_step_data: { mcAnswers: [
        { firstTryCorrect: true }, { firstTryCorrect: false }, { firstTryCorrect: false },
      ] } },
      created_at: '2026-10-30T08:00:00',
    },
    {
      lesson_uid: 'L0043', lesson_title: '朗讀課', station: 'key-passage-reading', station_label: '朗讀台',
      quality_passed: true, quality_score: 1, items_total: null, items_first_try_correct: null,
      cpm: 132, accuracy: 95, source_ref: { session_id: 6 }, created_at: '2026-10-29T08:00:00',
    },
  ],
};

beforeEach(() => {
  heatmapMock.mockReset();
  detailMock.mockReset();
});

describe('ReadingBabyIndicatorsPanel', () => {
  it('always shows the draft-review notice, even before data arrives', () => {
    heatmapMock.mockReturnValue(new Promise(() => {}));
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    expect(screen.getByText('課綱對照為草稿，待老師審核')).toBeInTheDocument();
  });

  it('screen 1: draws the class × indicator heatmap with names, curriculum text and statuses', async () => {
    heatmapMock.mockResolvedValue(HEATMAP);
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);

    const table = await screen.findByRole('table', { name: '班級 × 能力指標' });
    expect(heatmapMock).toHaveBeenCalledWith('tok', 7);
    const header = within(table).getByRole('columnheader', { name: /5-Ⅲ-6/ });
    expect(header).toHaveAttribute('title', '熟習適合學習階段的摘要策略，擷取大意。');
    const xiaoming = within(table).getByRole('row', { name: /王小明/ });
    expect(within(xiaoming).getByText('達成')).toBeInTheDocument();
    expect(within(xiaoming).getByText('帶得走')).toBeInTheDocument();
    const xiaohua = within(table).getByRole('row', { name: /李小華/ });
    expect(within(xiaohua).getByText('未達')).toBeInTheDocument();
    // 全班列：達成或帶得走的人數比例
    const whole = within(table).getByRole('row', { name: /全班/ });
    // 5-Ⅲ-6：王小明達成、李小華未達 → 1/2；5-Ⅲ-8：王小明帶得走、李小華沒指派 → 1/2
    expect(within(whole).getAllByText('50%')).toHaveLength(2);
  });

  it('never adds a 學習扶助 column (learning-support alignment conclusion)', async () => {
    heatmapMock.mockResolvedValue(HEATMAP);
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    await screen.findByRole('table', { name: '班級 × 能力指標' });
    expect(document.body.textContent).not.toMatch(/學習扶助/);
  });

  it('screen 2: clicking a student name opens that student\'s ability list', async () => {
    heatmapMock.mockResolvedValue(HEATMAP);
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: '李小華' }));

    const list = screen.getByRole('table', { name: '李小華的能力指標' });
    const rows = within(list).getAllByRole('row').slice(1);
    // not_assigned 的指標不列
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('5-Ⅲ-6');
    expect(rows[0]).toHaveTextContent('未達');
    expect(screen.getByText('課綱對照為草稿，待老師審核')).toBeInTheDocument();
  });

  it('screen 3: from the student list, a row drills into which lessons and items back it', async () => {
    heatmapMock.mockResolvedValue(HEATMAP);
    detailMock.mockResolvedValue(DETAIL);
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: '李小華' }));
    fireEvent.click(screen.getByRole('button', { name: /看 5-Ⅲ-6 的證據/ }));

    expect(await screen.findByText('大象的旅行')).toBeInTheDocument();
    expect(detailMock).toHaveBeenCalledWith('tok', 7, 12, '5-Ⅲ-6');
    expect(screen.getByText(/熟習適合學習階段的摘要策略/)).toBeInTheDocument();
    expect(screen.getByText(/首答 1\/3（33%）/)).toBeInTheDocument();
    const items = screen.getByRole('list', { name: '大象的旅行 逐題首答' });
    expect(within(items).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '第 1 題 首答答對', '第 2 題 首答答錯', '第 3 題 首答答錯',
    ]);
    expect(screen.getByText(/每分鐘 132 字/)).toBeInTheDocument();
    expect(screen.getByText('課綱對照為草稿，待老師審核')).toBeInTheDocument();
  });

  it('clicking a heatmap cell goes straight to screen 3; back returns to the heatmap', async () => {
    heatmapMock.mockResolvedValue(HEATMAP);
    detailMock.mockResolvedValue(DETAIL);
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: '李小華 5-Ⅲ-6 未達' }));
    await screen.findByText('大象的旅行');
    fireEvent.click(screen.getByRole('button', { name: /回熱力表/ }));
    expect(screen.getByRole('table', { name: '班級 × 能力指標' })).toBeInTheDocument();
  });

  it('empty class: explains that records appear once students finish stations', async () => {
    heatmapMock.mockResolvedValue({ ...HEATMAP, indicator_codes: [], indicators: [], cells: [] });
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    expect(await screen.findByText(/還沒有能力指標紀錄/)).toBeInTheDocument();
  });

  it('load failure shows a retry button that refetches', async () => {
    heatmapMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(HEATMAP);
    render(<ReadingBabyIndicatorsPanel classroomId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: '重新載入' }));
    expect(await screen.findByRole('table', { name: '班級 × 能力指標' })).toBeInTheDocument();
  });
});
