import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 簡介頁的紙本學習單只留**學用版 Word 一顆**（#2845）。
 *
 * Young 2026-08-21 會議：「只留下學用版的 Word 檔就好了。我不想要到時候
 * 還要管 PDF 有沒有轉轉好，因為我們之前有 PDF 什麼字型的問題」
 *
 * ⚠️ 這裡有一條比「幾顆按鈕」更重要的線：
 * `worksheet_docx_url` 在後端是 `_derive_docx_url(grade_code)` 從年級代碼**推**出來的。
 * 哪天那個路徑換成教用版，**不會有任何報錯，只會靜默把解答發給學生**。
 * 所以下面同時鎖住「只有一顆」與「那顆指向的是學用版」。
 */
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../Intro.tsx'), 'utf-8');

/**
 * ⚠️ 不要用「數所有含『學習單』的 aria-label」來判 —— 這個檔裡還有
 * **上傳學習單**（#1637）那一整套（已上傳學習單 / 關閉已上傳學習單），
 * 那是另一個功能，不該被算進來。我第一版就是這樣寫的，一開始就紅在錯的地方。
 *
 * 改成鎖「什麼不准出現」：PDF 那條路徑整條不准在，下載只准有一個呼叫點。
 */
function downloadCallSites(): string[] {
  return [...SRC.matchAll(/handleDownloadWorksheet\(([^)]*)\)/g)].map((m) => m[1]);
}

describe('#2845 簡介頁的紙本學習單只留一顆', () => {
  it('抓得到下載呼叫點（量具自檢）', () => {
    expect(downloadCallSites().length).toBeGreaterThan(0);
  });

  it('只有一個下載呼叫點，而且是 docx', () => {
    const sites = downloadCallSites();
    expect(sites, `下載呼叫點不只一個：${sites.join(' | ')}`).toHaveLength(1);
    expect(sites[0]).toContain('worksheetDocxUrl');
    expect(sites[0]).toContain("'docx'");
  });

  it('PDF 那條路整條不在了', () => {
    for (const dead of ['worksheetPdfUrl', 'showWorksheetModal', 'worksheetModalRef']) {
      expect(SRC, `${dead} 還在 —— PDF 那條路沒清乾淨`).not.toContain(dead);
    }
  });

  it('沒有任何按鈕自稱 PDF', () => {
    const pdfLabels = [...SRC.matchAll(/aria-label="([^"]*)"/g)]
      .map((m) => m[1]).filter((l) => /PDF/i.test(l));
    expect(pdfLabels, `PDF 按鈕還在：${pdfLabels.join(' / ')}`).toEqual([]);
  });

  it('⛔ 沒有任何地方把「教用版」發給學生', () => {
    // 靜默漏題的最後一道防線：worksheet_docx_url 是從年級代碼**推**出來的，
    // 路徑一旦換成教用版不會報錯，只會把解答發出去。
    expect(SRC).not.toMatch(/教用|teacher[-_]?edition|answer[-_]?key/i);
  });

  it('上傳學習單那套（#1637）沒有被我順手刪掉', () => {
    // 正向對照：上面每一條都是「不准有」，少了這條，把整個區塊刪光也會全綠
    expect(SRC).toContain('已上傳學習單');
    expect(SRC).toContain('worksheetDocxUrl');
  });
});
