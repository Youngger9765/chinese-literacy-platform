/**
 * 難字的判定法要講給人聽（#3257）
 *
 * 這支鎖的是**面板說了什麼**。它用假的 `difficultExplain` 餵四種狀態，因為那四種
 * 各自有不同的誠實義務，而其中兩種很難在整合測試裡湊出來（舊後端、還沒進課文）。
 *
 * 「面板報的層級 == 真正拿去標的層級」那條在
 * `context/__tests__/difficultSourceSingleOrigin3257.test.tsx`（真 provider）。
 * 兩支合起來才完整：這支管文案，那支管不會分岔。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { DifficultExplain } from '../../../context/ZhuyinContext';

const state: { explain: DifficultExplain; threshold: number } = {
  explain: { source: 'vocab', chars: [], errors: [], lessonLoaded: false },
  threshold: 1,
};

vi.mock('../../../context/ZhuyinContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context/ZhuyinContext')>();
  return {
    ...actual,
    useZhuyin: () => ({
      ...actual,
      difficultExplain: state.explain,
      difficultThreshold: state.threshold,
    }),
  };
});

// ⛔ 必須在 vi.mock 之後 import —— 不然拿到的是沒被攔截的真模組
const { default: DifficultRuleExplainer, formatErrorDate } = await import(
  '../DifficultRuleExplainer'
);

const ERRORS: DifficultExplain = {
  source: 'errors',
  chars: ['匪', '筋', '臼'],
  errors: [
    { char: '臼', count: 3, lastDate: '2026-08-24T06:24:23.810249Z' },
    { char: '匪', count: 1, lastDate: '2026-08-24T06:24:23.810249Z' },
  ],
  lessonLoaded: true,
};
const GRADE: DifficultExplain = {
  source: 'grade',
  chars: ['臼', '逼'],
  errors: [],
  lessonLoaded: true,
};
const VOCAB_OLD_BACKEND: DifficultExplain = {
  source: 'vocab',
  chars: [],
  errors: [],
  lessonLoaded: true,
};
const NO_LESSON: DifficultExplain = {
  source: 'vocab',
  chars: [],
  errors: [],
  lessonLoaded: false,
};

function openPanel(explain: DifficultExplain, threshold = 1) {
  state.explain = explain;
  state.threshold = threshold;
  render(<DifficultRuleExplainer />);
  fireEvent.click(screen.getByRole('button', { name: '這些字為什麼有注音' }));
}

beforeEach(() => {
  state.explain = NO_LESSON;
  state.threshold = 1;
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('#3257 收合預設關閉 —— 課文畫面不加雜訊', () => {
  it('⭐ 沒按開之前，畫面上不該有任何規則文字', () => {
    state.explain = ERRORS;
    render(<DifficultRuleExplainer />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/怎麼判定的/)).toBeNull();
    expect(screen.queryByText(/會標不準的地方/)).toBeNull();
    // 正向對照：觸發鈕本身要在（否則「什麼都沒 render」也會讓上面全綠）
    expect(screen.getByRole('button', { name: '這些字為什麼有注音' })).toBeTruthy();
  });

  it('Escape 關掉面板', () => {
    openPanel(ERRORS);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('點面板外面關掉，點面板裡面不關', () => {
    openPanel(ERRORS);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog'), '點自己身上不該關').toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('#3257 ① 你唸錯過的字', () => {
  it('⭐ 逐字講出錯幾次、最後一次是哪天 —— 不是只給一句規則', () => {
    openPanel(ERRORS);
    const panel = screen.getByRole('dialog');
    expect(panel.textContent).toContain('你唸錯過的字');
    // 這是這張票最核心的產出：具體到「哪個字、幾次、哪天」
    expect(panel.textContent).toContain('臼');
    expect(panel.textContent).toContain('錯 3 次');
    expect(panel.textContent).toContain('8/24');
    expect(panel.textContent).toContain('匪');
    expect(panel.textContent).toContain('錯 1 次');
  });

  it('負向對照：這一層不可以出現「這套教材字頻」那句話', () => {
    openPanel(ERRORS);
    // 那句話只適用第②層。在第①層講它是錯的資訊 ——
    // 少了這條，「限制永遠全部都印」也會讓 grade 那條綠
    expect(screen.getByRole('dialog').textContent).not.toContain('按這套教材的課文算的');
  });

  it('門檻 > 1 時要講「調低會標更多字」', () => {
    openPanel(ERRORS, 3);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('唸錯 3 次以上');
    expect(t).toContain('現在設 3 次');
    expect(t).toContain('會標更多字');
  });

  it('門檻 = 1 時講的是另一句（錯一次就標）', () => {
    openPanel(ERRORS, 1);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('錯一次就標');
    expect(t).toContain('會標更少字');
  });
});

describe('#3257 ② 這一課少見的字', () => {
  it('⭐ 說清楚是課文難度，不可以講成「你唸錯過的」', () => {
    openPanel(GRADE);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('這一課比較少見的字');
    expect(t).toContain('還沒有唸錯紀錄');
    expect(t).toContain('臼 逼');
    // 把別人的字說成是這個孩子唸錯的，比不說更糟
    expect(t).not.toContain('你唸錯過的字');
  });

  it('⭐ 要誠實揭露「少見是按這套教材算的，不是中文常用字」', () => {
    openPanel(GRADE);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('按這套教材的課文算的');
    expect(t).toContain('不是一般中文常用字');
  });
});

describe('#3257 ③ 生詞那一層 —— 就是被誤判成 bug 的那個狀態', () => {
  it('⭐ 誠實說「暫時用生詞代替，可能標到早就會的字」', () => {
    openPanel(VOCAB_OLD_BACKEND);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('本課生詞裡的字');
    expect(t).toContain('還沒算出難字');
    // 這一句就是 #3247 那次誤判的解藥
    expect(t).toContain('可能標到你早就會的字');
  });

  it('⭐ 還沒進課文時不可以謊稱在用生詞 —— 那時根本還不知道', () => {
    openPanel(NO_LESSON);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('還沒進到課文');
    expect(t).not.toContain('還沒算出難字');
    // 仍要講得出判定順序，否則這個狀態下面板等於沒內容
    expect(t).toContain('你唸錯過的字 → 這一課少見的字 → 本課生詞');
  });
});

describe('#3257 兩個限制在每一層都要講', () => {
  it.each([
    ['錯字層', ERRORS],
    ['年級層', GRADE],
    ['生詞層', VOCAB_OLD_BACKEND],
    ['還沒進課文', NO_LESSON],
  ])('%s：辨識會聽錯 + 跳過沒唸的字不會進清單', (_label, explain) => {
    openPanel(explain as DifficultExplain);
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t, '語音辨識會誤判要講').toContain('語音辨識可能聽錯');
    expect(t, '跳過沒唸的字不會進清單 —— 這條最反直覺，一定要講').toContain('跳過沒唸出來的字不會進清單');
  });
});

describe('#3257 日期格式化不可以印出 Invalid Date', () => {
  it.each([
    [null, null],
    ['', null],
    ['not-a-date', null],
    ['2026-08-24T06:24:23.810249Z', '8/24'],
  ])('formatErrorDate(%s) === %s', (iso, want) => {
    expect(formatErrorDate(iso as string | null)).toBe(want);
  });

  it('端點沒給日期時，只講次數不留破折號', () => {
    state.explain = {
      source: 'errors',
      chars: ['臼'],
      errors: [{ char: '臼', count: 2, lastDate: null }],
      lessonLoaded: true,
    };
    state.threshold = 1;
    render(<DifficultRuleExplainer />);
    fireEvent.click(screen.getByRole('button', { name: '這些字為什麼有注音' }));
    const t = screen.getByRole('dialog').textContent ?? '';
    expect(t).toContain('錯 2 次');
    expect(t).not.toContain('·');
  });
});
