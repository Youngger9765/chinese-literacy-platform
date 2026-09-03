/**
 * #3074 ①：老師要能「試做」一課，而不是只能看學生紀錄。
 *
 * 背景（Hans 現場教師回饋，2026-08~09 三場 demo）：校長問的是「這個功能操作
 * 起來是什麼感覺」。#3027 的學生預覽是**唯讀**的，點不進課、答不了題 ——
 * 它解的是另一個問題（這位學生現在看到什麼），做得對，不該改成可寫。
 *
 * 能力其實一直都在：LearningRouteGate 沒有角色檢查，教師帳號直接開
 * /learn/{story}/{step} 就能作答。缺的只是入口 —— 沒有真實老師會手打網址。
 *
 * 為什麼用老師自己的帳號而不是學生的：寫入落在老師身上，不碰任何真小孩的
 * 學習紀錄。班級統計走 ClassroomStudent 註冊列取人（live_monitor_service
 * 那條 query），老師不是自己班的 student，所以試做資料進不了班級統計 ——
 * 驗收條件 4 因此天生成立，不需要額外過濾。
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import TextManagementTab from '../TextManagementTab';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/teacherApi', () => ({
  getClassroomTexts: vi.fn().mockResolvedValue([
    { id: 1, text_id: '20011', title: '贏得喝采的輸家', assigned_at: '2026-09-01T00:00:00Z' },
  ]),
  assignText: vi.fn(),
  unassignText: vi.fn(),
  listStoryTags: vi.fn().mockResolvedValue([]),
  TeacherApiError: class TeacherApiError extends Error {},
}));

vi.mock('../../../services/api', () => ({
  fetchStories: vi.fn().mockResolvedValue({ stories: [], total: 0 }),
}));

describe('#3074 老師可以自己試做一課', () => {
  it('已指派的每一課都有「我來試做」入口', async () => {
    render(<TextManagementTab classroomId={1} />);
    await screen.findByText('贏得喝采的輸家');
    const btn = screen.getByRole('link', { name: /我來試做/ });
    expect(btn, '老師找不到入口就只能手打網址 —— 那等於沒有這個功能').toBeTruthy();
  });

  it('入口導到該課的學習流程（不是唯讀預覽）', async () => {
    render(<TextManagementTab classroomId={1} />);
    await screen.findByText('贏得喝采的輸家');
    const link = screen.getByRole('link', { name: /我來試做/ }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('/learn/20011');
    // 唯讀預覽是 /teacher/student-preview/*，導到那裡就是接錯了功能
    expect(
      link.getAttribute('href'),
      '導到唯讀預覽的話老師還是答不了題 —— 那正是這張票要解決的事',
    ).not.toContain('student-preview');
  });

  it('畫面明說這是老師自己在試做，不會跟看學生紀錄搞混', async () => {
    render(<TextManagementTab classroomId={1} />);
    await screen.findByText('贏得喝采的輸家');
    // ⚠️ 別用「或」串一堆候選字：拿掉其中一句、剩下的還會命中，mutation 就咬不住
    // （實測過）。要斷言的是那個**承諾**本身 —— 不會寫進學生紀錄、不進班級統計。
    const note = screen.getByText(/我來試做/, { selector: 'p' }).textContent ?? '';
    expect(note, `說明文字是「${note}」—— 少了「不會寫進學生紀錄」這個承諾，老師會不敢按`)
      .toMatch(/不會寫進學生/);
    expect(note, '也要說不會進班級統計，否則老師會擔心污染報表').toMatch(/班級統計/);
  });
});
