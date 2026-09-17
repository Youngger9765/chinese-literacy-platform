/**
 * 沒有錯字紀錄時，難字改用「年級字頻」而不是本課生詞（#3247）
 *
 * ## 家長實測回報（2026-09-17）
 *
 * > 「有些地方感覺是很簡單的字也會有注音，有一些感覺比較難的詞反而沒有注音」
 *
 * #3224 已經把「她唸錯過的字」那條路接對了。這支管的是**還沒有錯字紀錄**那條 ——
 * 第一次玩的孩子，也就是最需要鷹架的那一刻。原本退回 `story.vocabulary` 拆字：
 *
 *   四年級「運動科學」→ 標 32 個字，含「之 加 千 同 大 失 小 手 成」
 *   生詞欄位是空的那課 → 一個字都不標（開關看起來壞掉）
 *
 * ## 改法
 *
 * 難易度是**教材的屬性**，離線算好固化成表（`char_difficulty.json`），
 * 由 `/api/lessons/{uid}/zhuyin` 跟注音表同一趟回來（欄位 `hard`）。
 * 前端不算難度、不需要知道年級 —— 跟注音同一條紀律：**要用就是叫出來**。
 *
 * ⛔ 刻意不改 `processLinesSelective` 的簽名：四個消費端
 *    （FullTextAnnotate / KeyPassageReading / ComprehensionChat / ParagraphReading）
 *    都已經呼叫 `loadLessonZhuyin(story.lessonUid)`，provider 本來就知道是哪一課。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ZhuyinProvider, useZhuyin } from '../ZhuyinContext';
import { PolyphonicProcessor } from '../../components/zhuyin/polyphonicProcessor';

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const fake = {
    token: 'tok',
    user: { id: 7, name: '小朋友', role: 'student' },
    login: async () => {}, logout: () => {}, isLoading: false,
  };
  return { AuthContext: React.createContext(fake), useAuth: () => fake };
});

const LINE = '寒氣逼人的冬天，滴水穿石的石臼';
/** 本課生詞拆出來的字（舊來源）—— 含「人」「水」「石」 */
const VOCAB = ['寒氣逼人', '滴水穿石'];
/** 後端算好的難字（新來源）—— 只有真正少見的「臼」「逼」 */
const HARD = '臼逼';

function poyin() {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/poyin_db.json'), 'utf8'));
}

/** @param hard 端點回的 hard 欄位；null = 端點沒有這個欄位（舊後端） */
function mockFetch(hard: string | null) {
  const db = poyin();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('poyin_db')) return { ok: true, json: async () => db } as Response;
    if (u.includes('error-patterns')) {
      return { ok: true, json: async () => ({ patterns: [], total: 0 }) } as Response;
    }
    if (u.includes('/zhuyin')) {
      const body: Record<string, unknown> = { lesson_uid: 'L0019', texts: [] };
      if (hard !== null) body.hard = hard;
      return { ok: true, json: async () => body } as Response;
    }
    return { ok: false, status: 404 } as Response;
  }));
}

function annotatedChars(out: string | undefined): Set<string> {
  const got = new Set<string>();
  if (!out) return got;
  let inSpan = false;
  for (const ch of out) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xE01EA) { inSpan = true; continue; }
    if (cp === 0xE01EB) { inSpan = false; continue; }
    if (cp >= 0xE0100 && cp <= 0xE01EF) continue;
    if (inSpan) got.add(ch);
  }
  return got;
}

async function setup(hard: string | null) {
  mockFetch(hard);
  const { result } = renderHook(() => useZhuyin(), {
    wrapper: ({ children }) => <ZhuyinProvider>{children}</ZhuyinProvider>,
  });
  await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
  await act(async () => { await result.current.loadLessonZhuyin?.('L0019'); });
  return result;
}

beforeEach(() => {
  localStorage.setItem('zhuyin_mode_v2', 'difficult');
  (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
  vi.restoreAllMocks();
});

describe('#3247 沒有錯字紀錄時的難字來源', () => {
  it('⭐ 用後端算好的難字，不是生詞拆出來的字', async () => {
    const result = await setup(HARD);
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼'), '臼 在後端的難字集合裡，要標').toBe(true);
    expect(marked.has('逼'), '逼 同上').toBe(true);
    expect(marked.has('人'), '人 只是被「寒氣逼人」夾帶進來 —— 這就是家長回報的症狀').toBe(false);
    expect(marked.has('水'), '水 同上').toBe(false);
    expect(marked.has('石'), '石 同上').toBe(false);
  });

  it('正向對照：量具沒壞 —— 不在任何集合裡的字不會被標', async () => {
    const result = await setup(HARD);
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    // 少了這條，「全部都標」也會讓上面那條綠
    expect(marked.has('的')).toBe(false);
    expect(marked.has('冬')).toBe(false);
  });

  it('舊後端（回應沒有 hard 欄位）→ 仍然退回生詞，不是整片空白', async () => {
    const result = await setup(null);
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('人'), '沒有 hard 欄位時要退回生詞，否則部署順序會讓第二段消失').toBe(true);
  });

  it('換一課要換一組難字 —— 不可以沿用上一課的', async () => {
    const result = await setup('臼');
    expect(annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]).has('臼')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('poyin_db')) return { ok: true, json: async () => poyin() } as Response;
      if (u.includes('error-patterns')) return { ok: true, json: async () => ({ patterns: [], total: 0 }) } as Response;
      if (u.includes('/zhuyin')) return { ok: true, json: async () => ({ lesson_uid: 'L0002', texts: [], hard: '逼' }) } as Response;
      return { ok: false, status: 404 } as Response;
    }));
    await act(async () => { await result.current.loadLessonZhuyin?.('L0002'); });
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('逼'), '新課的難字要生效').toBe(true);
    expect(marked.has('臼'), '上一課的難字要被換掉，否則會跨課汙染').toBe(false);
  });
});

describe('#3247 難字必須進 memo 的 dep 鏈', () => {
  /**
   * 鎖的是：**難字晚到時，照真實元件形狀包的 memo 會拿到新值**
   * （真實時序 —— poyin_db 同源先到，跨網域的 `/api/lessons/{uid}/zhuyin` 後到）。
   *
   * ⚠️ 誠實說它**抓不到**什麼：把 `hardChars` 從 `processLinesSelective` 的 deps
   * 拿掉，這條仍然綠。因為難字跟注音表是同一趟回來的，`setAnswers` 同時也換了
   * 身分 → `toProcessed` 換 → callback 換 → memo 照樣重算。那個遺漏的 dep 在
   * 這條路徑上被遮蔽了，寫不出非造作的測試去分辨。
   *
   * 那個維度的門在 **lint**（`react-hooks/exhaustive-deps`，實測會報
   * 「missing dependency: 'hardChars'」）—— 但它在這個 repo 是 warn 不是 error，
   * 所以擋不了 PR。要真的擋住得把整條規則升成 error，那是全 repo 的改動，
   * 不屬於這張票。
   */
  it('⭐ 難字晚到時，照真實元件形狀包的 memo 必須重算', async () => {
    let releaseTable: (v: unknown) => void = () => {};
    const tablePromise = new Promise((r) => { releaseTable = r; });
    const db = poyin();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('poyin_db')) return { ok: true, json: async () => db } as Response;
      if (u.includes('error-patterns')) return { ok: true, json: async () => ({ patterns: [], total: 0 }) } as Response;
      if (u.includes('/zhuyin')) {
        await tablePromise;     // 表比 poyin_db 晚到 —— 真實時序
        return { ok: true, json: async () => ({ lesson_uid: 'L0019', texts: [], hard: HARD }) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }));

    const useLikeAComponent = () => {
      const { processLinesSelective, loadLessonZhuyin, zhuyinReady } = useZhuyin();
      const rendered = React.useMemo(
        () => processLinesSelective([LINE], VOCAB)?.[0],
        [processLinesSelective],
      );
      return { rendered, loadLessonZhuyin, zhuyinReady };
    };

    const { result } = renderHook(useLikeAComponent, {
      wrapper: ({ children }) => <ZhuyinProvider>{children}</ZhuyinProvider>,
    });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));

    // ① 難字還沒到：memo 已經算完，用的是生詞（舊行為）
    expect(annotatedChars(result.current.rendered).has('人')).toBe(true);

    // ② 難字到了
    await act(async () => {
      const p = result.current.loadLessonZhuyin?.('L0019');
      releaseTable(null);
      await p;
    });

    // ③ memo 必須重算 —— 這條紅代表畫面永遠停在生詞那一版
    const after = annotatedChars(result.current.rendered);
    expect(after.has('臼'), '難字到了之後 memo 沒重算 —— hardChars 沒進 deps').toBe(true);
    expect(after.has('人'), '生詞夾帶的字要消失').toBe(false);
  });
});

describe('#3247 難字不可以漏到下一課', () => {
  /**
   * 2026-09-17 複審抓到的形狀：`loadLessonZhuyin` 在 `!res.ok` 與 `catch` 兩條
   * 路徑上直接 return，於是**上一課的難字留著**，直接套到當下渲染的文字上。
   *
   * 這跟 `answers` 不對稱：`answers` 用整行文字當 key，過期的表對不到新課的文字
   * → 自然掉到 fallback，壞法是「少一排注音」。難字是沒有 key 的裸 Set，
   * 壞法是**標錯字** —— 而這個檔自己的註解就寫著「漏標只是少一排注音，標錯是
   * 教錯讀音」。
   *
   * 可達性：404 對合法課號走不到（179 課都有表），但 **429／5xx／斷線**走得到，
   * 而 #3227 處理的就是這一族端點的限流額度。
   */
  async function loadThen(result: { current: ReturnType<typeof useZhuyin> }, uid: string, respond: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('poyin_db')) return { ok: true, json: async () => poyin() } as Response;
      if (u.includes('error-patterns')) return { ok: true, json: async () => ({ patterns: [], total: 0 }) } as Response;
      if (u.includes('/zhuyin')) return respond();
      return { ok: false, status: 404 } as Response;
    }));
    await act(async () => { await result.current.loadLessonZhuyin?.(uid); });
  }

  it.each([
    ['429（限流，#3227 那一族）', () => ({ ok: false, status: 429 } as Response)],
    ['503', () => ({ ok: false, status: 503 } as Response)],
    ['斷線（fetch throw）', () => { throw new Error('network'); }],
  ])('第二課拿表失敗（%s）→ 不可以套用第一課的難字', async (_label, respond) => {
    const result = await setup('臼');
    expect(annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]).has('臼'))
      .toBe(true);

    await loadThen(result, 'L0002', respond as () => Response);

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼'), '上一課的難字標在這一課的課文上 —— 那是教錯字').toBe(false);
    // 正向對照：它該退回生詞，不是整片空白（否則「全部不標」也會讓上面那條綠）
    expect(marked.has('人'), '拿不到表要退回生詞').toBe(true);
  });
});
