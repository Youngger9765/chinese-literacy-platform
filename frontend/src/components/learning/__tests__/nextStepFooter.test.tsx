/**
 * 「下一關」只能有一種樣子。
 *
 * Young 2026-08-19：
 * > 下一關統一都用 footer 的格式，不要突然跑出一個按鈕來
 * > 不要有客製化的下一關按鈕
 *
 * 在此之前有七處各自畫了一顆，同一份漸層抄七次，而停用條件與提示文字各自決定。
 *
 * 下面第三條是這裡真正的鎖：它掃過所有 `.tsx`，任何自己畫「下一關」按鈕的地方
 * 都會紅。沒有這條，抽出共用元件只是多了一個沒人用的檔案 —— 這個專案今天
 * 已經有過「元件早就存在，只是那條路沒用它」的例子（拖拉排序）。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import NextStepFooter from '../NextStepFooter';

describe('NextStepFooter', () => {
  it('可按時會呼叫 onNext', () => {
    const onNext = vi.fn();
    render(<NextStepFooter onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /下一關/ }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('停用時不會前進，而且說得出為什麼', () => {
    const onNext = vi.fn();
    render(<NextStepFooter onNext={onNext} disabled disabledHint="完成閱讀聚光燈後才能繼續" />);
    fireEvent.click(screen.getByRole('button', { name: /下一關/ }));
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByText('完成閱讀聚光燈後才能繼續')).toBeTruthy();
  });

  it('沒有任何地方自己畫「下一關」按鈕', () => {
    const root = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && p.endsWith('.tsx') && !p.includes('.test.')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(50);   // 掃不到檔案的話下面恆綠

    const custom: string[] = [];
    for (const f of files) {
      if (f.endsWith('NextStepFooter.tsx')) continue;
      const src = fs.readFileSync(f, 'utf8');
      // `<button …>…下一關…</button>` —— 自己畫的那種
      for (const m of src.matchAll(/<button[\s\S]{0,900}?<\/button>/g)) {
        if (m[0].includes('下一關')) {
          custom.push(path.relative(root, f));
          break;
        }
      }
    }
    expect(custom).toEqual([]);
  });
});
