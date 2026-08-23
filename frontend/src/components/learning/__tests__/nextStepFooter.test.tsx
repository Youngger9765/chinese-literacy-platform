/**
 * 「下一關」只能有一種樣子。
 *
 * Young 2026-08-19：
 * > 下一關統一都用 footer 的格式，不要突然跑出一個按鈕來
 * > 不要有客製化的下一關按鈕
 *
 * 在此之前有七處各自畫了一顆，同一份漸層抄七次，而停用條件與提示文字各自決定。
 *
 * 下面第三條是這裡真正的鎖：它掃過所有 `.tsx`，任何自己畫「下一關」或
 * 「繼續下一步」按鈕的地方都會紅。
 *
 * #2771 postmortem：第一版鎖只抓「下一關」，漏了「繼續下一步」——同一個
 * 「前進到下一步」的按鈕，在這個 repo 裡有兩種措辭。結果是 7 處清掉了，
 * 另外 23 顆散在 14 個檔，全部逃過掃描，而測試本身是綠的。鎖只抓得到它
 * 認得的字，認不得的字就是視野盲區，不是「沒有」。
 *
 * 沒有這條，抽出共用元件只是多了一個沒人用的檔案 —— 這個專案今天
 * 已經有過「元件早就存在，只是那條路沒用它」的例子（拖拉排序）。
 *
 * 例外：`GraphicTextIntegrationExercise` 裡「我已讀完」那顆不算——它不是
 * 頁面級的「下一關」，是確認「這張練習卡讀完了」的內容內動作，跟
 * `GuidedStepsExercise`/`OrderingExercise` 的「確認」/「送出答案」同一種
 * 角色（按下去解鎖頁面下方真正的、停用狀態的 `NextStepFooter`）。改成
 * `NextStepFooter` 樣式反而會讓畫面同時出現兩顆一模一樣的紫色藥丸鈕
 * （一顆能按一顆停用），比原本更容易讓學生搞混哪顆才是真的「下一關」。
 * 該檔已把措辭從「我已讀完，繼續下一步」改成「我已讀完」，不會再撞進這條鎖。
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

  it('沒有任何地方自己畫「下一關」或「繼續下一步」按鈕', () => {
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

    // 這兩個字串在這個 repo 裡是同一件事的兩種措辭（見檔頭 #2771 postmortem）。
    const TRIGGER_PHRASES = ['下一關', '繼續下一步'];

    const custom: string[] = [];
    for (const f of files) {
      if (f.endsWith('NextStepFooter.tsx')) continue;
      const src = fs.readFileSync(f, 'utf8');
      // `<button …>…下一關/繼續下一步…</button>` —— 自己畫的那種
      for (const m of src.matchAll(/<button[\s\S]{0,900}?<\/button>/g)) {
        if (TRIGGER_PHRASES.some((phrase) => m[0].includes(phrase))) {
          custom.push(path.relative(root, f));
          break;
        }
      }
    }
    expect(custom).toEqual([]);
  });

  /**
   * #2897：上面那條只擋「自己畫一顆」，擋不住「用共用元件、但傳自己的字」。
   *
   * 實測（staging，2026-08-23）學生一路走過去看到的同一顆按鈕：
   *   重點朗讀 下一關 → 詞語理解 繼續下一步 → 語詞應用 繼續下一步 →
   *   文章重點表 下一關 → 閱讀理解 下一關 → 語詞複習 繼續下一步 →
   *   知識補給站 繼續下一步
   * 六處用預設、十八處傳「繼續下一步」。措辭是共用元件唯一還能各自決定的東西，
   * 所以它就是漂移最後的落腳處。
   *
   * 唯一允許的覆寫是「跳過，下一關」——空狀態要說清楚這一步被跳過了。
   */
  it('沒有任何地方把前進鈕的文字改成「繼續下一步」', () => {
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
    expect(files.length).toBeGreaterThan(50);

    const BANNED = /label=\{?['"`]繼續下一步/;
    // 正向對照：確認這個 matcher 認得出違規的寫法
    expect(BANNED.test('<NextStepFooter onNext={f} label="繼續下一步" />')).toBe(true);

    const offenders = files
      .filter((f) => BANNED.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
