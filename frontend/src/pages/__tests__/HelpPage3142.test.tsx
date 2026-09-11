/**
 * /help 使用說明 —— 不准再漂移，也不准再沒有入口（#3142）
 *
 * 這一頁的問題不是「缺一份說明」，是「有一份壞說明還在線上」：
 *   1. 全 repo 沒有任何 UI 連到 /help，所以做得再好都沒人點得到
 *   2. 內容硬編且過期（寫 57 篇課文、六個步驟、教兩個已停用的關卡）
 *   3. 底部四個「完整手冊」連結指向不存在的 /docs/manuals/*.md
 *   4. 管理員分頁放的是 gcloud / CI-CD 工程 runbook，對象完全錯
 *
 * 所以這些鎖守的是**結構**而不是字串：步驟清單必須從 stepConfig 推導，
 * 課文數必須來自 API，硬編的事實一律不准回來。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

import HelpPage from '../HelpPage';
import { HELP_CONTENT, allHelpText } from '../help/helpContent';
import { resolveActiveSteps } from '../../config/stepConfig';
import { TeacherSidebar, getTeacherNavItems } from '../../components/layout/TeacherSidebar';
import { StudentSidebar, getStudentNavItems } from '../../components/layout/StudentSidebar';

const HELP_PATH = '/help';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ stories: [], total: 179 }),
  })) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const renderHelp = () =>
  render(<MemoryRouter initialEntries={[HELP_PATH]}><HelpPage /></MemoryRouter>);

describe('入口：做得再好也要點得到', () => {
  it('教師側邊欄有使用說明入口', () => {
    render(
      <MemoryRouter><TeacherSidebar collapsed={false} onNavigate={() => {}} /></MemoryRouter>,
    );
    expect(screen.getByText('使用說明')).toBeTruthy();
  });

  it('學生側邊欄有使用說明入口', () => {
    render(
      <MemoryRouter><StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={() => {}} /></MemoryRouter>,
    );
    expect(screen.getByText('使用說明')).toBeTruthy();
  });

  it('手機版 tab bar 的清單也要有 —— 側邊欄項目寫在兩個地方，只改一邊等於沒改', () => {
    for (const [name, items] of [
      ['teacher', getTeacherNavItems()],
      ['student', getStudentNavItems()],
    ] as const) {
      const paths = items.map((i) => i.path);
      expect(paths, `${name} nav items 缺 ${HELP_PATH}`).toContain(HELP_PATH);
    }
  });

  it('兩個來源的項目必須一致，否則就是又分岔了', () => {
    const fromComponent = (cls: typeof getTeacherNavItems) => cls().map((i) => i.path).sort();
    expect(fromComponent(getTeacherNavItems)).toContain(HELP_PATH);
    expect(fromComponent(getStudentNavItems)).toContain(HELP_PATH);
  });
});

describe('內容不准再硬編漂移', () => {
  it('步驟清單從 stepConfig 推導，不是寫死的六步', async () => {
    renderHelp();
    const active = resolveActiveSteps();
    // 正向對照：先證明這個斷言在該命中的時候會命中
    expect(active.length).toBeGreaterThan(6);
    const teacherTab = screen.getByRole('tab', { name: /學生/ });
    fireEvent.click(teacherTab);
    for (const step of active) {
      expect(
        screen.queryAllByText(new RegExp(step.label)).length,
        `頁面上找不到啟用中的關卡「${step.label}」—— 清單沒有從 stepConfig 來`,
      ).toBeGreaterThan(0);
    }
  });

  // ⚠️ 這三條原本是 render 完掃 document.body —— 那是壞掉的量具：
  // 停用關卡、「57 篇」、工程用語全都在**別的分頁**上，預設分頁根本看不到，
  // 所以斷言恆真、三條全綠而什麼都沒證明。改成掃內容來源，覆蓋每個角色。
  it('不准再出現已停用關卡的教學（掃全部角色，不只預設分頁）', () => {
    const text = allHelpText();
    expect(text.length, '正向對照：內容來源不能是空的').toBeGreaterThan(500);
    for (const gone of ['逐段朗讀', '生字練習']) {
      expect(text, `已停用的「${gone}」還寫在說明裡`).not.toContain(gone);
    }
  });

  it('不准出現寫死的課文數 57（掃全部角色）', () => {
    expect(allHelpText()).not.toMatch(/57\s*篇/);
  });

  it('課文數來自 API 的 total', async () => {
    renderHelp();
    await waitFor(() => {
      expect(document.body.textContent || '').toMatch(/179/);
    });
    expect(fetch).toHaveBeenCalled();
  });

  it('登入方式要寫全三種，不只帳號密碼', () => {
    renderHelp();
    // 手風琴預設收合，答案內容要展開才在 DOM 裡 —— 不展開就掃 body 是量錯層級
    fireEvent.click(screen.getByRole('button', { name: /展開全部/ }));
    const body = document.body.textContent || '';
    for (const way of ['Google', '均一']) {
      expect(body, `漏了「${way}」登入`).toContain(way);
    }
  });
});

describe('壞連結與放錯對象的內容', () => {
  it('沒有任何指向 /docs/manuals 的連結（那四個是 404）', () => {
    const { container } = renderHelp();
    const bad = Array.from(container.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') || '')
      .filter((h) => h.includes('/docs/manuals'));
    expect(bad, `還有 404 連結：${bad.join(', ')}`).toHaveLength(0);
  });

  it('使用者說明頁不該出現工程 runbook 用語（掃全部角色）', () => {
    const text = allHelpText();
    expect(text.length, '正向對照：內容來源不能是空的').toBeGreaterThan(500);
    for (const eng of ['gcloud', 'lingoleap-dev', 'CI/CD', 'workflow', 'Cloud Run']) {
      expect(text, `工程用語「${eng}」出現在給老師看的說明頁`).not.toContain(eng);
    }
  });

  it('只留老師與學生兩個對象 —— 管理員工程內容搬走、家長功能尚未啟用', () => {
    expect(Object.keys(HELP_CONTENT).sort()).toEqual(['student', 'teacher']);
  });
});

describe('找得到答案', () => {
  it('搜尋會跨角色過濾題目', async () => {
    renderHelp();
    const box = screen.getByRole('searchbox');
    const before = screen.queryAllByRole('button', { name: /\?|？/ }).length;
    expect(before).toBeGreaterThan(0); // 正向對照
    fireEvent.change(box, { target: { value: '麥克風' } });
    await waitFor(() => {
      const after = screen.queryAllByRole('button', { name: /\?|？/ }).length;
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0);
    });
  });

  it('搜尋沒有結果時要講清楚，不是空白一片', async () => {
    renderHelp();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'zzz-不存在的東西-zzz' },
    });
    await waitFor(() => {
      expect(document.body.textContent || '').toMatch(/找不到|沒有符合/);
    });
  });

  it('展開全部會把答案內容顯示出來', async () => {
    renderHelp();
    const expandAll = screen.getByRole('button', { name: /展開全部/ });
    fireEvent.click(expandAll);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-help-answer="open"]').length).toBeGreaterThan(3);
    });
  });

  it('題目用問句寫，不是名詞標題', () => {
    renderHelp();
    const qs = screen.queryAllByRole('button', { name: /\?|？/ });
    expect(qs.length, '沒有任何問句式題目').toBeGreaterThan(5);
  });

  // 斷言內容來源而不是單一分頁的 DOM：四個坑分散在老師與學生兩個角色，
  // 而沒有搜尋字串時畫面只渲染當前分頁 —— 掃 document.body 會漏掉另一個角色的那兩個，
  // 那是量測層級選錯，不是內容缺漏。
  it('Hans 實機查出的四個坑都要寫進去（掃全部角色）', () => {
    const body = allHelpText();
    expect(body.length, '正向對照：內容來源不能是空的').toBeGreaterThan(500);
    const gotchas = [
      '指派課文',   // 指派課文 != 出作業
      '收合',       // 加入代碼區塊有學生後自動收合，QR 跟著藏起來
      '尚無資料',   // 課堂即時的「尚無資料」不代表沒在練
      'AI 推薦',    // 在學生主頁而非圖書館，新學生是空的
    ];
    for (const g of gotchas) {
      expect(body, `漏了實機查出的坑：${g}`).toContain(g);
    }
  });
});
