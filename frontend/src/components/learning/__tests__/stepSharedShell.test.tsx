/**
 * 自學模式每一步的外框，只能有一份實作。
 *
 * #2897：盤點 11 個 enabled step 之後，兩塊 markup 各自被抄了很多份 ——
 *   - 底部固定動作列：11 份逐字相同，連 `#FBF6EE` 都硬寫 11 次
 *   - 「怎麼玩？」教學卡：6 份，而且已經漂開（紫/琥珀、text-lg/text-base、
 *     account_tree/lightbulb、mb-4/mb-5）
 *
 * 抽成 `StepActionBar` / `StepCoachCard` 之後，沒有這條掃描鎖的話，下一個人
 * 只要複製貼上就又多一份 —— 這個 repo 已經有過「元件早就存在，只是那條路
 * 沒用它」的先例（`nextStepFooter.test.tsx` 檔頭記的 23 顆客製按鈕）。
 *
 * 掃描鎖有一種安靜的失效方式：class 字串被改名之後，掃描器什麼都找不到，
 * 於是恆綠。所以每條掃描都配一個「正向對照」——先證明這個 matcher 對
 * 一段刻意違規的字串會命中，再拿它去掃 repo。命中 0 才有意義。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import StepActionBar from '../StepActionBar';
import StepCoachCard, { StepCoachHelpButton } from '../StepCoachCard';

const SRC_ROOT = path.resolve(__dirname, '../../..');

function allTsx(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.tsx') && !p.includes('.test.')) out.push(p);
    }
  };
  walk(SRC_ROOT);
  return out;
}

/** 自己畫底部固定動作列的樣子。 */
const drawsOwnActionBar = (src: string) =>
  src.includes('fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20');

/** 自己畫琥珀教學卡的樣子（底色＋邊框＋「我知道了」三者同時出現才算）。 */
const drawsOwnCoachCard = (src: string) =>
  src.includes('border-amber-400/60') && src.includes('bg-amber-50') && src.includes('我知道了');

describe('StepActionBar', () => {
  it('渲染傳進來的內容', () => {
    render(<StepActionBar><button type="button">錄音</button></StepActionBar>);
    expect(screen.getByRole('button', { name: '錄音' })).toBeInTheDocument();
  });

  it('四種 layout 都套得到對應的排列 class', () => {
    const { rerender } = render(<StepActionBar layout="stack">x</StepActionBar>);
    const inner = () => screen.getByTestId('step-action-bar').firstElementChild!;
    expect(inner().className).toContain('flex flex-col gap-2');
    rerender(<StepActionBar layout="stack-center">x</StepActionBar>);
    expect(inner().className).toContain('flex flex-col items-center gap-3');
    // row：水平並排（讀全文-做記號的「播放全文 + 完成標記」，#2941）
    rerender(<StepActionBar layout="row">x</StepActionBar>);
    expect(inner().className).toContain('flex items-center justify-center gap-3');
    expect(inner().className).not.toContain('flex-col');
    rerender(<StepActionBar>x</StepActionBar>);
    expect(inner().className).not.toContain('flex flex-col');
    // 四種都必須帶上共用的寬度限制，否則同一顆按鈕在不同步驟會是不同寬度
    expect(inner().className).toContain('max-w-md');
  });

  it('沒有任何檔案自己畫底部固定動作列', () => {
    // 正向對照：先確認這個 matcher 認得出違規的樣子
    expect(drawsOwnActionBar('<div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20">')).toBe(true);

    const files = allTsx();
    expect(files.length).toBeGreaterThan(50); // 掃不到檔案的話下面恆綠
    const owner = files.filter((f) => f.endsWith(`${path.sep}StepActionBar.tsx`));
    expect(owner).toHaveLength(1); // 樣式真的還住在共用元件裡（改名就會紅）
    expect(drawsOwnActionBar(fs.readFileSync(owner[0], 'utf8'))).toBe(true);

    const offenders = files
      .filter((f) => !f.endsWith(`${path.sep}StepActionBar.tsx`))
      .filter((f) => drawsOwnActionBar(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('共用元件真的被用著（不是抽出來放著沒人叫）', () => {
    const users = allTsx().filter((f) =>
      /import StepActionBar from '.*StepActionBar'/.test(fs.readFileSync(f, 'utf8')),
    );
    // 抽取當下是 11 個 call site。用下限而不是等號：新增步驟不該讓這條紅，
    // 但整批被改回手寫就會掉到 11 以下。
    expect(users.length).toBeGreaterThanOrEqual(11);
  });
});

describe('StepCoachCard', () => {
  it('示範 / 我知道了 各自呼叫對應的 callback', () => {
    const onDemo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <StepCoachCard title="語詞應用怎麼玩？" onDemo={onDemo} onDismiss={onDismiss}>
        讀句子，選出最適合的語詞。
      </StepCoachCard>,
    );
    expect(screen.getByText('語詞應用怎麼玩？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '示範' }));
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(onDemo).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('icon 可指定，預設 lightbulb', () => {
    const { rerender } = render(
      <StepCoachCard title="t" onDemo={() => {}} onDismiss={() => {}}>b</StepCoachCard>,
    );
    const card = () => screen.getByTestId('step-coach-card');
    expect(card().querySelector('.material-symbols-outlined')?.textContent).toBe('lightbulb');
    rerender(
      <StepCoachCard title="t" icon="account_tree" onDemo={() => {}} onDismiss={() => {}}>b</StepCoachCard>,
    );
    expect(card().querySelector('.material-symbols-outlined')?.textContent).toBe('account_tree');
  });

  it('StepCoachHelpButton 點了會叫 onClick', () => {
    const onClick = vi.fn();
    render(<StepCoachHelpButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /怎麼玩？/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('沒有任何檔案自己畫教學卡', () => {
    // 正向對照
    expect(
      drawsOwnCoachCard('<div className="border-amber-400/60 bg-amber-50"><button>我知道了</button></div>'),
    ).toBe(true);

    const files = allTsx();
    expect(files.length).toBeGreaterThan(50);
    const owner = files.filter((f) => f.endsWith(`${path.sep}StepCoachCard.tsx`));
    expect(owner).toHaveLength(1);
    expect(drawsOwnCoachCard(fs.readFileSync(owner[0], 'utf8'))).toBe(true);

    const offenders = files
      .filter((f) => !f.endsWith(`${path.sep}StepCoachCard.tsx`))
      .filter((f) => drawsOwnCoachCard(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('共用教學卡真的被用著', () => {
    const users = allTsx().filter((f) =>
      /import StepCoachCard(?:, \{[^}]*\})? from '.*StepCoachCard'/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(users.length).toBeGreaterThanOrEqual(6);
  });
});
