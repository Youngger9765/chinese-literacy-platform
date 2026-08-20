/**
 * 一格裡同時有填空與選擇題時，兩種空格都要能作答。
 *
 * L0102「對網紅實驗的批判」是「1 個填空 + 2 個選擇」。後端修好之後
 * `blanks` 會是 `[{}, {options:[…]}, {options:[…]}]` —— 第一個沒有 options。
 *
 * 前端原本對「沒有 options 的空格」渲染一段純文字 `【　　　】`
 * （註解寫著「寧可留原樣也不要憑空造一組選項」，那個判斷是對的），
 * 但那一格因此**不能作答** —— 學生看得到卻填不了。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoryStructureTable from '../StoryStructureTable';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test', user: { id: 1, role: 'student' } }),
}));

const STRUCTURE = {
  title: '測試',
  layout: 'worksheet_table',
  rows: [
    {
      label: '對網紅實驗的批判',
      // 後端修好後的形狀：第 1 個空格是填空（沒有 options），第 2、3 個是選擇
      value: '有害物質根本【　　　】。\n電子煙是【　　　】到肺裡的，\n網紅把煙油【　　　】下肚。',
      interactive_type: 'inline_choice',
      blanks: [{}, { options: ['吸', '吃'] }, { options: ['吸', '吃'] }],
    },
  ],
  interaction_profile: {
    mode: 'mixed', layout: 'worksheet_table',
    fill_blank_count: 0, checkbox_count: 0, inline_choice_count: 1,
  },
};

beforeEach(() => {
  global.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/structure')) {
      return { ok: true, status: 200, json: async () => STRUCTURE } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

describe('混合形狀的格子', () => {
  it('沒有選項的那個空格要是可輸入的，不是一段死文字', async () => {
    render(<StoryStructureTable storyId={1} />);
    const inputs = await screen.findAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it('兩個選擇題空格各自有自己的選項按鈕', async () => {
    render(<StoryStructureTable storyId={1} />);
    const buttons = await screen.findAllByRole('button');
    const optionButtons = buttons.filter((b) => /^(吸|吃)$/.test((b.textContent || '').trim()));
    expect(optionButtons.length).toBe(4);
  });
});
