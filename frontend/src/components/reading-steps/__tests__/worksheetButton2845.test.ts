import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 簡介頁的紙本學習單下載（#2845 → #3276 角色分權擴充）。
 *
 * #2845（Young 2026-08-21 會議）：「只留下學用版的 Word 檔就好了。我不想要到時候
 * 還要管 PDF 有沒有轉轉好，因為我們之前有 PDF 什麼字型的問題」—— PDF 這條路
 * 至今仍不可加回來，下面前三條原封不動鎖著這件事。
 *
 * ⚠️ #2845 原本還鎖了兩件事，這次**改寫**而不是保留：
 *
 * 1. 「只有一個下載呼叫點，且指向 worksheetDocxUrl」—— 這條鎖的是舊機制
 *    （`worksheet_docx_url` 從年級代碼**推**出來，後端零角色檢查）。#3276 把
 *    整個下載機制換成 `worksheetDownloadUrl(lessonUid, version)` +
 *    `downloadAuthenticatedFile`（帶 Bearer token，後端 `require_role` 做真正
 *    的角色檢查），呼叫點本來就會變成兩個（student / teacher）。繼續鎖「只有
 *    一個」會直接擋掉這次故意的功能擴充。
 *
 * 2. 「沒有任何地方出現教用版/teacher-edition/answer-key」—— 這條當年鎖的是
 *    「這個檔案本來就不該提到教師版，一出現就是漏題」。#3276 讓教師版變成
 *    刻意存在、有伺服器端角色檢查撐腰的功能，禁字regex 已經不對；而且它的
 *    比對方式（`teacher[-_]?edition` 這種連續字串）根本抓不到這次新程式碼
 *    的命名（`isTeacherTier`、`handleDownloadWorksheetEdition('teacher')`），
 *    留著它只會製造「測試綠但沒在測任何東西」的假象。
 *
 *    真正的防線改成行為測試——見
 *    `Intro.worksheetRoleGate3276.test.tsx`：用不同角色掛載真元件，斷言
 *    DOM 裡看不看得到教師版按鈕、點下去打的是哪支 API。靜態 regex 測不出
 *    「這顆按鈕是不是真的被角色擋住」，只有真的 render 才測得出來。
 *
 *    這裡保留一條窄範圍的靜態檢查，鎖住原本那條線真正在乎的東西：
 *    教師版的下載**只能**透過帶認證的 `downloadAuthenticatedFile`，
 *    不能透過匿名的 `downloadRemoteFile`/裸 `fetch`——那才是「不會報錯，
 *    只會靜默把解答發給學生」的根因（機制本身沒有身分檢查），
 *    不是「檔案裡有沒有出現這幾個字」。
 */
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../Intro.tsx'), 'utf-8');

describe('#2845/#3276 簡介頁的紙本學習單下載', () => {
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

  it('⛔ 下載一律走帶認證的 downloadAuthenticatedFile，不用匿名的 downloadRemoteFile', () => {
    // 這是舊「教用版禁字 regex」真正要防的事的現代版本：機制本身有沒有
    // 身分檢查，不是檔案裡有沒有出現某幾個字。downloadRemoteFile（匿名，
    // 沒有 Authorization header）如果被重新引入去抓教師版檔案，後端
    // require_role 仍會擋（伺服器端才是唯一真防線），但那就代表前端在用
    // 錯誤的工具打一個它打不通的端點——值得在這裡先抓到。
    expect(SRC).not.toMatch(/import\s*\{[^}]*\bdownloadRemoteFile\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/utils\/downloadRemoteFile['"]/);
    expect(SRC, '教師版/學生版下載必須用 downloadAuthenticatedFile').toContain('downloadAuthenticatedFile');
  });

  it('上傳學習單那套（#1637）沒有被我順手刪掉', () => {
    // 正向對照：上面每一條都是「不准有」，少了這條，把整個區塊刪光也會全綠
    expect(SRC).toContain('已上傳學習單');
    expect(SRC).toContain('getPriorOmoUploadByLesson');
  });

  it('教師版渲染條件掛在 isTeacherTier 上（量具自檢——擋不掉表示鎖本身失效）', () => {
    // 這條只確認「有這個守門條件存在於原始碼」，不確認它真的擋住渲染——
    // 真正的行為驗證在 Intro.worksheetRoleGate3276.test.tsx（已用 mutation
    // 驗過：拿掉這個條件會讓那邊 2 條測試變紅）。這裡只是量具自檢，
    // 避免有人把整段 JSX 砍光但這個檔案還是綠的。
    expect(SRC).toMatch(/isTeacherTier\s*&&\s*story\.worksheetAvailable\?\.teacher/);
  });
});
