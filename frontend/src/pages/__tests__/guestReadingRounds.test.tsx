import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

/**
 * QR 掃進來的人是**未登入的訪客**，走 GuestReadingPage —— 不走 LearningLayout。
 *
 * 2026-08-25 真瀏覽器實測：L0063 三篇的讀全文 QR 掃出來的內容**逐字相同**
 * （各 2822 字元）。輪次切換掛在 LearningLayout 上，而訪客根本不經過它。
 * 資料層的檢查全綠、API 回應正確、頁面打得開、0 pageerror —— 只有真的
 * 用瀏覽器走那條路才看得到。
 */
const detail = {
  id: 20063, title: '多篇課', grade: '6', grade_code: 'G6-L22',
  paragraphs: ['篇1的第一段', '篇1的第二段'],
  key_reading: { passage: '篇1的重點段', start_text: null, extent_chars: null, source: null },
  manifest_sections: [
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: 'p3kud' },
    { no: '二', name: '念順順', module: 'key_reading', slug: 'yprak', text_ref: 'p3kud' },
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: '4uee3' },
    { no: '二', name: '念順順', module: 'key_reading', slug: '9a7x4', text_ref: '4uee3' },
  ],
  repeat_rounds: {
    p3kud: { key_reading: { passage: '篇1的重點段' } },
    '4uee3': {
      // 後端每一輪都附上**攤平好的** `paragraphs`（字串陣列，跟 API 頂層同形狀）。
      // fixture 用真實形狀 —— 用自己編的形狀寫 fixture 是這一輪已經犯過的錯：
      // 測試綠、真頁面 `text.match is not a function`。
      paragraphs: ['篇2的第一段', '篇2的第二段'],
      full_text_annotate: { paragraphs: [{ idx: 1, text: '篇2的第一段' }, { idx: 2, text: '篇2的第二段' }] },
      key_reading: { passage: '篇2的重點段' },
    },
  },
};

vi.mock('../../services/apiConfig', () => ({ API_BASE: 'http://x.test' }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => detail,
  })) as never);
});

const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/learn/:storyId/*" element={<GuestReadingPage />} /></Routes>
    </MemoryRouter>,
  );

import GuestReadingPage from '../GuestReadingPage';

describe('訪客掃 QR 進來：要看到自己那一篇', () => {
  it('第 2 篇的念順順顯示第 2 篇的重點段', async () => {
    at('/learn/20063/key-passage-reading?p=9a7x4');
    await waitFor(() => expect(screen.queryByText('載入中…')).toBeNull());
    expect(document.body.textContent).toContain('篇2的重點段');
    expect(document.body.textContent).not.toContain('篇1的重點段');
  });

  it('第 1 篇仍然是第 1 篇 —— 不是「有換就算對」', async () => {
    at('/learn/20063/key-passage-reading?p=yprak');
    await waitFor(() => expect(screen.queryByText('載入中…')).toBeNull());
    expect(document.body.textContent).toContain('篇1的重點段');
    expect(document.body.textContent).not.toContain('篇2的重點段');
  });

  it('第 2 篇的讀全文顯示第 2 篇的段落', async () => {
    at('/learn/20063/full-text-annotate?p=4uee3');
    await waitFor(() => expect(screen.queryByText('載入中…')).toBeNull());
    expect(document.body.textContent).toContain('篇2的第一段');
    expect(document.body.textContent).not.toContain('篇1的第一段');
  });

  it('沒有 ?p= 的單篇課照舊 —— 不因為這個改動而壞掉', async () => {
    at('/learn/20063/key-passage-reading');
    await waitFor(() => expect(screen.queryByText('載入中…')).toBeNull());
    expect(document.body.textContent).toContain('篇1的重點段');
  });
});
