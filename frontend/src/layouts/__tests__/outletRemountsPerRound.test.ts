/**
 * #4081 — 多篇課換篇次（只改 `?p=`）時，步驟頁要重新掛載。
 *
 * 同一種關卡的各篇共用一條路由，React Router 不會因為 query string 換掉元件；
 * 步驟頁用 ref 凍結的還原快照與作答 state 都還是上一篇的，而存檔函式已經換成
 * 新篇次的 key —— 上一篇的作答被寫進下一篇。實際行為在瀏覽器以 20063 驗證；
 * 這裡鎖住接線，免得有人把 key 拿掉。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../LearningLayout.tsx'), 'utf8');

describe('LearningLayout remounts the step page per round (#4081)', () => {
  it('positive control: the file is the layout and renders an Outlet', () => {
    expect(SRC).toContain('<Outlet context={ctx} />');
  });

  it('the Outlet is keyed by the full step key (base id + #round)', () => {
    expect(SRC).toMatch(/<React\.Fragment key=\{stepKey\}>\s*<Outlet context=\{ctx\} \/>/);
    expect(SRC).toMatch(/const stepKey = useCurrentStepId\(''\)/);
  });
});
