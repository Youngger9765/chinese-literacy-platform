/**
 * 訪客掃「重點朗讀」QR 進來，聽到的要是重點段（#2930）。
 *
 * 訪客頁把 `content` 換成重點段，所以**畫面**是對的；
 * 但朗讀走 `lessonId + 段落序號` 的句子對照表，
 * 那一對定址到的是**整課課文的第 0 段** —— 重點段根本不在 paragraphs 的索引裡。
 * 於是畫面顯示重點段、聲音唸課文開頭，而且不會報錯。
 *
 * 擁有者 2026-08-26 在 prod 用真 QR 復現（9 張抽查都一樣）。
 *
 * 修法：這條路不要用課號定址 —— 直接用傳進去的文字合成。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../..');

describe('訪客的重點朗讀', () => {
  const guest = readFileSync(join(SRC, 'pages/GuestReadingPage.tsx'), 'utf8');

  it('掃描有效（正向對照：找得到那段把 content 換成重點段的邏輯）', () => {
    expect(guest, '訪客頁不再把 content 換成重點段？那這條測試該重寫').
      toMatch(/wantsPassage\s*&&\s*passage/);
  });

  it('換成重點段時，要明確關掉課號定址', () => {
    // 只要 `shown` 帶著重點段，就必須告訴朗讀元件別用 lessonId 去對照句子。
    expect(
      /disableCanonicalMapping|lessonId=\{undefined\}|noLessonAddressing/.test(guest),
      '訪客頁把 content 換成重點段，卻沒關掉課號定址 —— 聲音會唸課文第一段',
    ).toBe(true);
  });
});
