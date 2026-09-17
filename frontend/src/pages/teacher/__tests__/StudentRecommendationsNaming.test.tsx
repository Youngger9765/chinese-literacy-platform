/**
 * 鎖住「按鈕名稱不得承諾看得到學生畫面」（#3220）。
 *
 * ## 為什麼需要這條鎖
 *
 * `/teacher/preview/:studentId` 整頁只列五筆 AI 推薦課文，**不顯示學生當下的
 * 畫面、也不顯示他寫了什麼**。但按鈕原本叫「預覽」、tooltip 原本寫「以學生身分
 * 預覽（唯讀）」，於是：
 *
 *   - 老師以為點下去會看到學生的螢幕
 *   - 照著 UI 寫教師手冊的人，把它寫成「可以看到他實際看到什麼」——寫錯了
 *
 * 命名和實體對不上，靠的是「大家記得別改回去」。這條鎖把它變成機器守著。
 *
 * ## 這條鎖刻意用負向斷言
 *
 * 只斷言「按鈕上寫著推薦練習」是不夠的 —— 那擋不住有人在 tooltip 或 banner
 * 另外寫一句「看學生的畫面」。所以真正咬得住的是那組 FORBIDDEN 字串：
 * **任何承諾「看得到學生畫面／作答」的文案都不得出現在這個流程的 UI 上**，
 * 直到第三期真的把那個能力做出來為止。
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/progressApi', () => ({
  getStoryRecommendations: vi.fn().mockResolvedValue({ recommendations: [], total: 0 }),
}));

import StudentProgressCard from '../components/StudentProgressCard';
import StudentPreviewPage from '../StudentPreviewPage';
import type { StudentProgress } from '../../../services/teacherApi';

/** 會讓老師以為「看得到學生當下畫面／作答」的說法，一律不准出現。 */
const FORBIDDEN = [
  '以學生身分預覽',
  '看到他的畫面',
  '看他的畫面',
  '學生的畫面',
  '即時畫面',
  '實際看到什麼',
];

const student: StudentProgress = {
  student_id: 7,
  student_name: '小美',
  last_session_date: '2026-09-13',
  last_text_title: '十秒的背後',
  total_sessions: 2,
  tags: [],
};

describe('教師端「推薦練習」的命名 (#3220)', () => {
  it('學生卡片上的按鈕叫「推薦練習」，不叫「預覽」', () => {
    render(
      <MemoryRouter>
        <StudentProgressCard
          student={student}
          isExpanded={false}
          isPreviewLoading={false}
          instructionCount={0}
          onExpand={vi.fn()}
          onPreview={vi.fn()}
          onInstruction={vi.fn()}
          onManageTags={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /推薦練習/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^預覽$/ })).toBeNull();
  });

  it('卡片上沒有任何「看得到學生畫面」的說法（含 tooltip）', () => {
    const { container } = render(
      <MemoryRouter>
        <StudentProgressCard
          student={student}
          isExpanded={false}
          isPreviewLoading={false}
          instructionCount={0}
          onExpand={vi.fn()}
          onPreview={vi.fn()}
          onInstruction={vi.fn()}
          onManageTags={vi.fn()}
        />
      </MemoryRouter>,
    );
    // 連 title 屬性一起掃 —— 誤導的說法上次就是寫在 tooltip 裡
    const haystack = container.innerHTML;
    for (const phrase of FORBIDDEN) {
      expect(haystack).not.toContain(phrase);
    }
  });

  it('推薦頁的 banner 主動說明「這裡看不到他當下的畫面或作答」', () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/teacher/preview/7',
            state: {
              previewToken: 't',
              studentId: 7,
              studentName: '小美',
              expiresInMinutes: 20,
            },
          },
        ]}
      >
        <StudentPreviewPage />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('推薦練習（唯讀）');
    // 正向斷言：必須主動講清楚它「不是」什麼，否則老師還是會誤會
    expect(banner.textContent).toContain('看不到他當下的畫面');
    for (const phrase of FORBIDDEN) {
      expect(banner.innerHTML).not.toContain(phrase);
    }
  });
});
