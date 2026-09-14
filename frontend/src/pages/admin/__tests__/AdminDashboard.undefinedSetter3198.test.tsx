/**
 * #3198 回歸鎖：AdminDashboard 有三個呼叫點參照一個不存在的識別字 `setSelectedNode`。
 *
 * `8ad8919e8 feat: admin panel URL slugs` 把 selectedNode 從 state 改成從網址推導：
 *     const selectedNode = slugToNode(location.pathname);   // :75
 * state 沒了、setter 自然也沒了，但三個呼叫點留在原地 ——
 * 在這個檔裡 `setSelectedNode` 出現 3 次、宣告 0 次、沒有 import。
 * JS 對未宣告的識別字在求值當下丟 ReferenceError，所以那三個按鈕按下去就是白畫面。
 *
 * 為什麼一直沒被發現：tsc 從來沒進過 CI（build 是裸 vite build）。這三條是
 * TS2304: Cannot find name，型別檢查一跑就抓到 —— 它們就在 #3195 棘輪的 39 個既有錯誤裡。
 *
 * ⚠️ 這裡把所有子面板換成 stub，因為要測的是 **AdminDashboard 自己的接線**，
 *    不是那些面板。stub 只做一件事：把拿到的 callback 掛到一顆按鈕上。
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'admin', is_admin: true }, logout: vi.fn() }),
}));

/**
 * 每個 stub 把收到的 callback 變成一顆按鈕，按下去就等於使用者做了那件事。
 * ⚠️ 要包在 vi.hoisted 裡 —— vi.mock 會被提升到檔案最上面，
 *    普通的 const 在那個時間點還沒初始化。
 */
const { stub } = vi.hoisted(() => ({
  stub: (testid: string, propName: string, arg: unknown) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (props: any) =>
      React.createElement(
        'button',
        { 'data-testid': testid, onClick: () => props[propName]?.(arg) },
        testid,
      ),
  }),
}));

vi.mock('../ClassroomDetailPanel', () => stub('crumb-back-to-school', 'onBackToSchool', 7));
vi.mock('../OrgDetailPanel', () => stub('pick-school', 'onSelectSchool', 9));
vi.mock('../CreateOrgPanel', () => stub('cancel-create-org', 'onCancel', undefined));
vi.mock('../AdminTreeSidebar', () => ({ default: () => <nav data-testid="sidebar" /> }));
vi.mock('../SchoolDetailPanel', () => ({ default: () => <div data-testid="school-panel" /> }));
vi.mock('../OrgDashboardPanel', () => ({ default: () => <div /> }));
vi.mock('../UsersPanel', () => ({ default: () => <div /> }));
vi.mock('../StoryManagementPanel', () => ({ default: () => <div /> }));
vi.mock('../tts-audit/TtsSentenceTable', () => ({ default: () => <div /> }));
vi.mock('../lesson-audio/LessonAudioTable', () => ({ default: () => <div /> }));
vi.mock('../story-structure-lab/StoryStructureLabPage', () => ({ default: () => <div /> }));
vi.mock('../KeypointsQADashboard', () => ({ default: () => <div /> }));

import AdminDashboard from '../AdminDashboard';

/** 把當下的網址印出來，讓斷言看得到導航有沒有發生 */
const Where = () => <span data-testid="where">{useLocation().pathname}</span>;

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminDashboard />
      <Where />
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;

/**
 * 按下去並把「handler 有沒有炸掉」抓回來。
 *
 * ⚠️ 不能用 expect(...).not.toThrow()：React 不會把事件處理器的例外同步往上丟，
 *    它會走 window 的 error 事件。第一版就是這樣寫的，結果三條測試裡
 *    not.toThrow() 全部「通過」，真正紅的是網址沒變那條 —— 那個綠是假的。
 */
function clickAndCatch(testid: string): Error | null {
  // ⚠️ 先把元素找出來，再進 try —— 找不到元素是「測試自己壞了」，
  //    跟「handler 炸了」是兩件事。放在同一個 try 裡的話，選擇器打錯會被
  //    報成「handler 丟了例外：Unable to find an element…」，讓看到紅燈的人
  //    去追一個不存在的問題。
  const el = screen.getByTestId(testid);

  let caught: Error | null = null;
  const onErr = (e: ErrorEvent) => { caught = e.error ?? new Error(e.message); };
  window.addEventListener('error', onErr);
  try {
    fireEvent.click(el);
  } catch (e) {
    caught = e as Error;            // jsdom 有時仍會同步丟
  } finally {
    window.removeEventListener('error', onErr);
  }
  return caught;
}

describe('#3198 管理後台三個按鈕不可以丟 ReferenceError', () => {
  it('量具有效：在班級網址下，那顆麵包屑按鈕真的 render 出來了', () => {
    at('/admin/classroom/3');
    expect(screen.getByTestId('crumb-back-to-school')).toBeTruthy();
  });

  it('⭐ 班級詳情按麵包屑的學校名稱 → 不可以丟例外，而且要導到那間學校', () => {
    at('/admin/classroom/3');
    const err = clickAndCatch('crumb-back-to-school');
    expect(err, `handler 丟了例外：${err?.message}`).toBeNull();
    expect(where()).toBe('/admin/school/7');
  });

  it('⭐ 機構詳情點一間學校 → 不可以丟例外，而且要導到那間學校', () => {
    at('/admin/org/abc-123');
    const err = clickAndCatch('pick-school');
    expect(err, `handler 丟了例外：${err?.message}`).toBeNull();
    expect(where()).toBe('/admin/school/9');
  });

  it('⭐ 建立機構面板按「取消」→ 不可以丟例外，而且要回到 /admin', () => {
    at('/admin/create-org');
    const err = clickAndCatch('cancel-create-org');
    expect(err, `handler 丟了例外：${err?.message}`).toBeNull();
    expect(where()).toBe('/admin');
  });

  it('對照：網址本來就決定畫面 —— 直接開學校網址不會經過這三個按鈕', () => {
    at('/admin/school/5');
    expect(screen.getByTestId('school-panel')).toBeTruthy();
    expect(where()).toBe('/admin/school/5');
  });
});
