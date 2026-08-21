/**
 * 「練習工具箱」不可以再出現在學生導覽上（Young 2026-08-20 指示，#2801）。
 *
 * 有兩個來源：桌面側欄自己的 `toolsItems`，以及給 MobileTabBar 用的
 * 匯出常數 `studentToolsItems`。只清掉一個，另一個入口還在 ——
 * 今天已經被「只修一半」咬過好幾次，所以兩個都鎖。
 *
 * ⛔ 學習紀錄頁上的「練習工具箱」是**過去紀錄的標籤**（徽章與分組標題），
 * 不是入口，刻意保留 —— 拿掉會把學生已完成的練習紀錄標籤抹掉。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudentSidebar, studentToolsItems, getStudentNavItems } from '../StudentSidebar';

// ⚠️ props 照 `StudentSidebarProps` 寫 —— 我第一版自己編了一個 `pathname`，
// React 會忽略不認識的 prop，所以測試照樣綠，是 tsc 才抓到。

describe('學生導覽不再有練習工具箱', () => {
  it('MobileTabBar 用的那份是空的', () => {
    expect(studentToolsItems).toEqual([]);
  });

  it('桌面側欄上找不到它', () => {
    render(
      <MemoryRouter>
        <StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('練習工具箱')).toBeNull();
    expect(screen.queryByText(/\/tools/)).toBeNull();
  });

  it('正向對照：其他導覽項目還在（不是整個側欄壞掉）', () => {
    render(
      <MemoryRouter>
        <StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={() => {}} />
      </MemoryRouter>,
    );
    // 少了這條，上面兩條在「側欄整個沒 render」時也會綠
    expect(screen.getByText('圖書館')).toBeTruthy();
    expect(getStudentNavItems().length).toBeGreaterThan(2);
  });
});
