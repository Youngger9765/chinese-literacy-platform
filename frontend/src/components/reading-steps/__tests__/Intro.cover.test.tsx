/**
 * 課文封面圖破圖 —— 我今天只修了一半。
 *
 * 上午修的是圖書館列表（`StoryCard.tsx`）：沒有封面就不 render `<img>`。
 * Young 下午在**課內**又看到同一個破圖 icon 加「《十秒的背後》課文封面圖」。
 *
 * `Intro.tsx` 是另一個 render 封面的地方，它沒有守衛：
 *
 *     <img src={story.thumbnail} alt={`《${story.title}》課文封面圖`} />
 *
 * 二修 175 課一張封面都沒有，所以 `story.thumbnail` 是空字串 ——
 * `<img src="">` 在瀏覽器裡就是破圖。
 *
 * ⚠️ 這是今天第四次「只修了一半」（另外三次：干擾項只掃 rows 沒掃
 * worksheet_rows、選項只認 list 沒認 dict、計數器改了顯示沒改分母）。
 * 所以這裡不只測 Intro —— 下面那條掃**所有**會 render 封面的地方，
 * 用數量斷言。「有一個修好了」不是覆蓋率。
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null, isAuthenticated: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Intro from '../Intro';

const STORY = {
  id: 20001, title: '十秒的背後', thumbnail: '', level: 4,
  category: 'narrative', content: '', lesson_code: 'G4-L10',
};

describe('沒有封面時不要畫破圖', () => {
  it('Intro 不 render 空 src 的 <img>', () => {
    const { container } = render(<MemoryRouter><Intro story={STORY as never} onNext={() => {}} /></MemoryRouter>);
    const broken = Array.from(container.querySelectorAll('img')).filter(
      (img) => !img.getAttribute('src'),
    );
    expect(broken.length).toBe(0);
  });

  it('有封面時照樣顯示（正向對照）', () => {
    const { container } = render(
      <MemoryRouter>
        <Intro story={{ ...STORY, thumbnail: '/assets/x.webp' } as never} onNext={() => {}} />
      </MemoryRouter>,
    );
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.some((i) => i.getAttribute('src') === '/assets/x.webp')).toBe(true);
  });

  it('每一個 render 封面的地方都有守衛（掃全部，不是抽一個）', () => {
    const root = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('__')) walk(p);
        else if (e.isFile() && p.endsWith('.tsx') && !p.includes('.test.')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(50);   // 掃不到檔案的話下面恆綠

    const unguarded: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // `<img ... src={...thumbnail...}` 而該行附近沒有任何守衛
      const re = /<img[^>]*src=\{([^}]*thumbnail[^}]*)\}/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const before = src.slice(Math.max(0, m.index - 260), m.index);
        const guarded = /\?\s*\(|&&|imgOk|onError|\?\./.test(before) || /\?\./.test(m[1]);
        if (!guarded) unguarded.push(`${path.relative(root, f)} → ${m[1].trim()}`);
      }
    }
    expect(unguarded).toEqual([]);
  });
});
