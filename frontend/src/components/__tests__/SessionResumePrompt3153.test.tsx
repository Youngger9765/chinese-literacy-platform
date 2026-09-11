/**
 * 「繼續上次的學習」—— 不准再刪掉學生的續學紀錄（#3153）
 *
 * 原本的守衛是 `if (currentStep <= 1 || currentStep >= 6) clearActiveSession()`，
 * 註解寫「step 6 = report = 已完成」。但 `dbStepNumber` **不按序列順序**：
 *
 *   序 1  lesson-intro         1
 *   序 2  full-text-annotate   8   ← bootstrap 開課就寫這個
 *   序 3  key-passage-reading  6   ← 6 是重點朗讀，不是報告
 *   ...
 *   序 11 report               7   ← 報告是 7
 *
 * 所以學生一打開課文寫入 8，`8 >= 6` 成立，紀錄當場被刪。這個功能對真實學生
 * **永遠不會出現**，而且不是安靜地不顯示，是把資料清掉。
 *
 * 這一支守的是「判斷要用身分不要用數字」。⛔ 任何拿 dbStepNumber 做大小比較的
 * 寫法都會讓下面第一條紅。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

import SessionResumePrompt from '../SessionResumePrompt';
import { resolveActiveSteps } from '../../config/stepConfig';

const USER_ID = 42;

const clearSpy = vi.fn();
const loadSpy = vi.fn();

vi.mock('../../services/api', () => ({
  loadActiveSession: (...a: unknown[]) => loadSpy(...a),
  clearActiveSession: (...a: unknown[]) => clearSpy(...a),
  fetchStory: async () => ({ title: '穿越極限的跑者' }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID, name: '小明', role: 'student' } }),
}));

const record = (currentStep: number) => ({
  storyId: '20006',
  currentStep,
  timestamp: Date.now(),
});

beforeEach(() => { clearSpy.mockClear(); loadSpy.mockClear(); });
afterEach(() => vi.clearAllMocks());

const renderPrompt = () =>
  render(<MemoryRouter><SessionResumePrompt /></MemoryRouter>);

const steps = resolveActiveSteps();
const first = steps[0];
const last = steps[steps.length - 1];
const middle = steps[1];            // full-text-annotate, dbStepNumber 8
const keyReading = steps.find((s) => s.id === 'key-passage-reading')!;

describe('正向對照：這些數字真的如我所述', () => {
  it('序列第二步的 dbStepNumber 大於最後一步的，證明數值比較沒有意義', () => {
    expect(middle.id).toBe('full-text-annotate');
    expect(last.id).toBe('report');
    expect(middle.dbStepNumber).toBeGreaterThan(last.dbStepNumber);
  });
});

describe('不准刪掉還能續的紀錄', () => {
  it('⭐ 開課就寫入的那一步（讀全文-做記號）必須留著並顯示提示', async () => {
    loadSpy.mockReturnValue(record(middle.dbStepNumber));
    renderPrompt();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /繼續學習/ })).toBeTruthy();
    });
    expect(clearSpy, '這一步被清掉了 —— 就是 #3153 那個 bug').not.toHaveBeenCalled();
  });

  it('重點朗讀（dbStepNumber 6）也要留著，6 不是報告', async () => {
    loadSpy.mockReturnValue(record(keyReading.dbStepNumber));
    renderPrompt();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('顯示的關卡名稱來自 stepConfig，不是寫死的舊名', async () => {
    loadSpy.mockReturnValue(record(keyReading.dbStepNumber));
    renderPrompt();
    await waitFor(() => {
      expect(document.body.textContent).toContain(keyReading.label);
    });
    // 舊的寫死表把 5 叫「全文朗讀」，那個名字已經不存在
    expect(document.body.textContent).not.toContain('全文朗讀');
  });
});

describe('該清的還是要清', () => {
  it('停在序列第一步（剛開始）→ 清掉，不顯示', async () => {
    loadSpy.mockReturnValue(record(first.dbStepNumber));
    renderPrompt();
    await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(String(USER_ID)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('停在序列最後一步（報告＝已完成）→ 清掉，不顯示', async () => {
    loadSpy.mockReturnValue(record(last.dbStepNumber));
    renderPrompt();
    await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(String(USER_ID)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('已停用的關卡（逐段朗讀）→ 清掉，不要把孩子丟進去', async () => {
    loadSpy.mockReturnValue(record(2));   // paragraph-reading, enabled: false
    renderPrompt();
    await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(String(USER_ID)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('對不到任何關卡的數字 → 清掉', async () => {
    loadSpy.mockReturnValue(record(999));
    renderPrompt();
    await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(String(USER_ID)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('超過 7 天的紀錄 → 清掉（既有行為，不可退化）', async () => {
    loadSpy.mockReturnValue({
      ...record(middle.dbStepNumber),
      timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });
    renderPrompt();
    await waitFor(() => expect(clearSpy).toHaveBeenCalledWith(String(USER_ID)));
  });
});

describe('沒有寫死的關卡表', () => {
  it('原始碼裡不准再有數字到關卡的寫死對照表', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync('src/components/SessionResumePrompt.tsx', 'utf8');
    // 正向對照：檔案讀到了
    expect(raw.length).toBeGreaterThan(500);

    // ⚠️ 先剝掉註解再比對。這條斷言問的是「code 還在做數值比較嗎」，而檔頭的註解
    // 刻意**引述了那個舊守衛**當作紀錄 —— 不剝註解的話，這條測試會因為那段說明而紅，
    // 逼人去刪掉最有價值的那段文字。第一版就是這樣誤判的。
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 區塊註解
      .replace(/^\s*\/\/.*$/gm, '');        // 行註解

    // 剝完之後仍要有東西可驗，否則這條測試是空的
    expect(src).toContain('resolveStoredStep');

    expect(src, '還有寫死的 number→path 表').not.toMatch(/^\s*2:\s*'paragraph-reading'/m);
    expect(src, '還有寫死的關卡名稱表').not.toMatch(/^\s*5:\s*'全文朗讀'/m);
    expect(src, '還在拿 currentStep 做大小比較').not.toMatch(/currentStep\s*(>=|<=|>|<)\s*\d/);
  });
});
