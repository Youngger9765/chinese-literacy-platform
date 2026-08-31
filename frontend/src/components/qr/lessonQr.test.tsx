import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import LessonQrButton from './LessonQrButton';
import { buildLessonQrValue, hasWholeTextToRead, qrFileName, QR_ENTRY_ORIGIN } from './lessonQr';
import * as adminTable from '../../pages/admin/lesson-audio/LessonAudioTable';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async (v: string) => `data:image/png;base64,QR(${v})`) },
}));

afterEach(() => { vi.restoreAllMocks(); });

describe('hasWholeTextToRead — 全文碼看資料不看年級（#3011）', () => {
  /**
   * 這一組原本列的是「整個年級集合」（4–7 true、8–9/文言文/品格教育 false），
   * 因為當時的規則就是由年級定義的。#3011 之後判準換成「這一節有沒有課文」，
   * 所以這裡列的是**輸入形狀的全集** —— 呼叫端手上真的會拿到的每一種值。
   *
   * ⛔ 這不是把斷言放寬：沒有課文仍然 false（後四列），而且新增了
   *    「空陣列」「非陣列」這兩種舊規則根本問不到的假資料形狀。
   */
  const CORPUS_SHAPES: Array<[string, boolean | readonly unknown[] | null | undefined, boolean]> = [
    ['has_full=true（清單端點算好的）', true, true],
    ['段落陣列有內容', ['第一段', '第二段'], true],
    ['單段也算', ['只有一段'], true],
    ['has_full=false', false, false],
    ['空陣列（抽取失敗留下的形狀）', [], false],
    ['null（欄位不存在）', null, false],
    ['undefined（欄位沒送）', undefined, false],
  ];

  it.each(CORPUS_SHAPES)('%s -> %s', (_label, input, expected) => {
    expect(hasWholeTextToRead(input)).toBe(expected);
  });

  it('涵蓋每一種真的會進來的形狀，3 通過 / 4 擋掉', () => {
    // 擋住這張表被悄悄修剪成好過的那幾列。
    expect(CORPUS_SHAPES).toHaveLength(7);
    expect(CORPUS_SHAPES.filter(([, , yes]) => yes)).toHaveLength(3);
    expect(CORPUS_SHAPES.filter(([, , yes]) => !yes)).toHaveLength(4);
  });

  it('年級不再是判準 —— 非數字年級的課有課文一樣拿得到碼', () => {
    // 明珠老師 2026-08-31 回報的那 11 課，grade 是字串 `品格教育`。
    // 舊規則 `Number.parseInt('品格教育')` = NaN → 整批擋掉。
    expect(hasWholeTextToRead(['體育不只是身體的事'])).toBe(true);
  });
});

describe('the URL rule has exactly one implementation', () => {
  it('the admin table re-exports the shared function rather than owning a copy', () => {
    // Structural, not behavioural: two implementations that agree today are
    // the shape that drifted last time. Identity is the only assertion that
    // stays true only while there is genuinely one of them.
    expect(adminTable.buildLessonQrValue).toBe(buildLessonQrValue);
    expect(adminTable.hasWholeTextToRead).toBe(hasWholeTextToRead);
    expect(adminTable.qrFileName).toBe(qrFileName);
  });

  it('points 全文 at full-text-annotate, not lesson-intro', () => {
    // Regression: 「QR code全文朗讀的部分會進到課程簡介」
    expect(buildLessonQrValue('https://x.test', 7, 'full-text-annotate'))
      .toBe('');
    expect(buildLessonQrValue('https://x.test', 7, 'key-passage-reading'))
      .toBe('');
  });

  it('zero-pads the filename', () => {
    expect(qrFileName('qr-full', 7)).toBe('qr-full-L07.png');
    expect(qrFileName('qr-key-reading', 123)).toBe('qr-key-reading-L123.png');
  });
});

describe('LessonQrButton', () => {
  it('opens a preview showing the encoded URL, then downloads a PNG', async () => {
    const clicked: Array<{ href: string; download: string }> = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = () => {
          clicked.push({
            href: (el as HTMLAnchorElement).href,
            download: (el as HTMLAnchorElement).download,
          });
        };
      }
      return el;
    });

    render(<LessonQrButton lessonId={7} step="key-passage-reading" lessonTitle="風箏" sectionSlug="mcyjp" />);

    fireEvent.click(screen.getByRole('button', { name: '顯示重點朗讀 QR code' }));

    const url = `${QR_ENTRY_ORIGIN}/q/mcyjp`;
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // The URL is on screen so a teacher can check it before printing.
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.getByRole('img', { name: /QR code/ }).getAttribute('src'))
      .toBe(`data:image/png;base64,QR(${url})`);

    fireEvent.click(screen.getByRole('button', { name: '下載 PNG' }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('qr-key-reading-L07.png');
    expect(clicked[0].href).toContain('QR(');
  });

  it('keeps the caller-supplied label as the accessible name', () => {
    // The admin table renders two of these per row, both reading "QR", and
    // finds them by that name. An unconditional aria-label would replace it.
    render(<LessonQrButton lessonId={3} step="full-text-annotate" lessonTitle="風箏" label="QR" sectionSlug="mcyjp" />);
    expect(screen.getByRole('button', { name: 'QR' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /顯示全文朗讀/ })).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<LessonQrButton lessonId={1} step="full-text-annotate" lessonTitle="風箏" sectionSlug="mcyjp" />);
    fireEvent.click(screen.getByRole('button', { name: '顯示全文朗讀 QR code' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
