import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import LessonQrButton from './LessonQrButton';
import { buildLessonQrValue, deliversFullText, qrFileName } from './lessonQr';
import * as adminTable from '../../pages/admin/lesson-audio/LessonAudioTable';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async (v: string) => `data:image/png;base64,QR(${v})`) },
}));

afterEach(() => { vi.restoreAllMocks(); });

describe('deliversFullText — 4-7 全文+段落, 8-9 段落 only', () => {
  /**
   * The whole grade set as staging actually serves it (175 lessons, stories
   * === total, measured 2026-08-23). A table of two or three hand-picked cases
   * would pass with the rule half-written; this one names every value the
   * corpus contains, so a rule that forgets the non-numeric grades fails here
   * rather than in front of a teacher.
   */
  const CORPUS_GRADES: Array<[string, boolean]> = [
    ['4', true], ['5', true], ['6', true], ['7', true],
    ['8', false], ['9', false],
    ['文言文', false], ['品格教育', false],
  ];

  it.each(CORPUS_GRADES)('grade %s -> %s', (grade, expected) => {
    expect(deliversFullText(grade)).toBe(expected);
  });

  it('covers every grade the corpus has, and the split is 4 yes / 4 no', () => {
    // Guards the table above against being quietly trimmed to the easy cases.
    expect(CORPUS_GRADES).toHaveLength(8);
    expect(CORPUS_GRADES.filter(([, yes]) => yes)).toHaveLength(4);
    expect(CORPUS_GRADES.filter(([, yes]) => !yes)).toHaveLength(4);
  });

  it('accepts numbers too (the admin list types grade as number)', () => {
    expect(deliversFullText(7)).toBe(true);
    expect(deliversFullText(8)).toBe(false);
  });
});

describe('the URL rule has exactly one implementation', () => {
  it('the admin table re-exports the shared function rather than owning a copy', () => {
    // Structural, not behavioural: two implementations that agree today are
    // the shape that drifted last time. Identity is the only assertion that
    // stays true only while there is genuinely one of them.
    expect(adminTable.buildLessonQrValue).toBe(buildLessonQrValue);
    expect(adminTable.deliversFullText).toBe(deliversFullText);
    expect(adminTable.qrFileName).toBe(qrFileName);
  });

  it('points 全文 at full-text-annotate, not lesson-intro', () => {
    // Regression: 「QR code全文朗讀的部分會進到課程簡介」
    expect(buildLessonQrValue('https://x.test', 7, 'full-text-annotate'))
      .toBe('https://x.test/learn/7/full-text-annotate');
    expect(buildLessonQrValue('https://x.test', 7, 'key-passage-reading'))
      .toBe('https://x.test/learn/7/key-passage-reading');
  });

  it('zero-pads the filename', () => {
    expect(qrFileName('qr-full', 7)).toBe('qr-full-L07.png');
    expect(qrFileName('qr-passage', 123)).toBe('qr-passage-L123.png');
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

    render(<LessonQrButton lessonId={7} step="key-passage-reading" lessonTitle="風箏" />);

    fireEvent.click(screen.getByRole('button', { name: '顯示段落朗讀 QR code' }));

    const url = `${window.location.origin}/learn/7/key-passage-reading`;
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // The URL is on screen so a teacher can check it before printing.
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.getByRole('img', { name: /QR code/ }).getAttribute('src'))
      .toBe(`data:image/png;base64,QR(${url})`);

    fireEvent.click(screen.getByRole('button', { name: '下載 PNG' }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('qr-passage-L07.png');
    expect(clicked[0].href).toContain('QR(');
  });

  it('keeps the caller-supplied label as the accessible name', () => {
    // The admin table renders two of these per row, both reading "QR", and
    // finds them by that name. An unconditional aria-label would replace it.
    render(<LessonQrButton lessonId={3} step="full-text-annotate" lessonTitle="風箏" label="QR" />);
    expect(screen.getByRole('button', { name: 'QR' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /顯示全文朗讀/ })).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<LessonQrButton lessonId={1} step="full-text-annotate" lessonTitle="風箏" />);
    fireEvent.click(screen.getByRole('button', { name: '顯示全文朗讀 QR code' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
