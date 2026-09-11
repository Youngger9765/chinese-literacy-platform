/**
 * /help 的實機截圖與裝置切換（#3151）
 *
 * #3142 刻意沒做這兩項，關票時另開 #3151 接著。這一支守三件事：
 *
 *   1. `helpContent.ts` 引用的每個 shot id，檔案與 manifest 裡都要真的存在
 *      —— 引用一個不存在的圖 = 使用說明上一個破圖，比沒有圖更糟
 *   2. 裝置切換要真的換掉 src，不是只換一個 class
 *   3. 截圖點得開（放大檢視）
 *
 * ⛔ 這裡刻意**不**斷言「manifest 裡的每張圖都被引用」。那個方向會逼人為了讓測試綠
 *    而硬塞圖進不相干的問答裡。要守的是「引用的都存在」，不是「存在的都被引用」。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import HelpPage from '../HelpPage';
import { HELP_CONTENT, HELP_ROLE_ORDER, HELP_DEVICES, allHelpShots } from '../help/helpContent';

const PUBLIC_DIR = join(process.cwd(), 'public');
const MANIFEST = join(PUBLIC_DIR, 'help-shots', 'manifest.json');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ stories: [], total: 179 }),
  })) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const renderHelp = () =>
  render(<MemoryRouter initialEntries={['/help']}><HelpPage /></MemoryRouter>);

describe('引用的截圖必須真的存在', () => {
  it('至少有引用一些截圖（正向對照：清單不能是空的）', () => {
    expect(allHelpShots().length).toBeGreaterThan(4);
  });

  it('manifest 檔案存在且涵蓋兩種裝置', () => {
    expect(existsSync(MANIFEST), `找不到 ${MANIFEST}`).toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const devices = new Set(m.shots.map((s: { device: string }) => s.device));
    expect([...devices].sort()).toEqual(Object.keys(HELP_DEVICES).sort());
  });

  it('每個被引用的 shot，兩種裝置的檔案都在磁碟上', () => {
    const missing: string[] = [];
    for (const id of allHelpShots()) {
      for (const dev of Object.keys(HELP_DEVICES)) {
        const p = join(PUBLIC_DIR, 'help-shots', `${id}-${dev}.png`);
        if (!existsSync(p)) missing.push(`${id}-${dev}.png`);
      }
    }
    expect(missing, `引用了但檔案不存在：${missing.join(', ')}`).toHaveLength(0);
  });

  it('每個被引用的 shot 都在 manifest 裡（檔案在但沒進 manifest = 來源不明）', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const known = new Set(m.shots.map((s: { id: string }) => s.id));
    const orphan = allHelpShots().filter((id) => !known.has(id));
    expect(orphan, `不在 manifest 裡：${orphan.join(', ')}`).toHaveLength(0);
  });

  it('shot id 只能出現在有內容的問答上，不能憑空多出來', () => {
    const fromContent = new Set<string>();
    for (const role of HELP_ROLE_ORDER) {
      for (const sec of HELP_CONTENT[role].sections) {
        for (const e of sec.entries) (e.shots || []).forEach((s) => fromContent.add(s));
      }
    }
    expect([...fromContent].sort()).toEqual([...new Set(allHelpShots())].sort());
  });
});

describe('裝置切換', () => {
  it('有裝置切換的控制項，兩個選項', () => {
    renderHelp();
    const group = screen.getByRole('group', { name: /裝置/ });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole('radio').length).toBe(Object.keys(HELP_DEVICES).length);
  });

  it('切換裝置會換掉圖片的 src，不是只換 class', async () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: /展開全部/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('img[data-help-shot]').length).toBeGreaterThan(0);
    });
    const srcOf = () => Array.from(document.querySelectorAll('img[data-help-shot]'))
      .map((i) => i.getAttribute('src') || '').join('|');
    const before = srcOf();
    expect(before).toMatch(/-desktop\.png/);

    const ipad = screen.getByRole('radio', { name: /iPad 直式/ });
    fireEvent.click(ipad);
    await waitFor(() => {
      const after = srcOf();
      expect(after).not.toBe(before);
      expect(after).toMatch(/-ipad\.png/);
      expect(after).not.toMatch(/-desktop\.png/);
    });
  });
});

describe('點擊放大', () => {
  it('點截圖會打開放大檢視，Escape 關掉', async () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: /展開全部/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('img[data-help-shot]').length).toBeGreaterThan(0);
    });
    expect(document.querySelector('[data-help-lightbox]')).toBeNull();   // 正向對照：一開始沒開

    const first = document.querySelector('img[data-help-shot]') as HTMLElement;
    fireEvent.click(first);
    await waitFor(() => {
      expect(document.querySelector('[data-help-lightbox]')).not.toBeNull();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-help-lightbox]')).toBeNull();
    });
  });

  it('截圖有 alt 文字，不是空的', async () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: /展開全部/ }));
    await waitFor(() => {
      const imgs = Array.from(document.querySelectorAll('img[data-help-shot]'));
      expect(imgs.length).toBeGreaterThan(0);
      for (const i of imgs) {
        expect((i.getAttribute('alt') || '').trim().length).toBeGreaterThan(3);
      }
    });
  });
});
