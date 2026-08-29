/**
 * lessonQr — the one place that decides what a lesson QR code points at.
 *
 * ## Why this is shared rather than local to the admin panel
 *
 * The QR flow was built inside `pages/admin/lesson-audio/LessonAudioTable.tsx`
 * for the 教材端 (they paste the PNGs into Word). Owner then asked for the same
 * code on the two learning pages a teacher actually has open in class, so the
 * URL rule now has two callers. Two callers of a rule that must agree is
 * exactly the shape that drifted last time: an earlier version of the guest
 * landing page played its own pre-generated mp3, the two paths diverged within
 * days, and the owner heard it («全文朗讀的登錄的前後那個用的音怎麼不一樣啊»).
 *
 * So the rule lives here once and both surfaces import it. `LessonAudioTable`
 * re-exports these names so its existing tests keep addressing them where they
 * always were.
 *
 * ## What the URL is
 *
 * `/learn/{id}/{step}` — the ordinary learning route. A visitor who has never
 * logged in does NOT get a password box there: `LearningRouteGate` hands them
 * `GuestReadingPage`, which shows the text and reads it aloud. That is the
 * whole point of printing the code on paper (#2649).
 *
 * ⚠️ 全文 points at `full-text-annotate`, not `lesson-intro`. Pointing it at
 * the intro was reported as a bug: 「QR code全文朗讀的部分會進到課程簡介」.
 */
import QRCode from 'qrcode';

export type LessonQrStep = 'full-text-annotate' | 'key-passage-reading';

/**
 * Grades 4-7 get 全文 + 段落; grades 8-9 get 段落 only.
 * Source: docs/requirements/reading-demo-audio-qr.md §R1.
 *
 * ⚠️ `grade` arrives from the API as a **string**, and 23 of the 175 lessons
 * carry a non-numeric one (`文言文` 12, `品格教育` 11 — measured against
 * staging 2026-08-23, stories === total). The original signature said `number`
 * and leaned on JS coercion, which happened to give the right answer for the
 * numeric cases and `false` for the other two. This spells that out instead of
 * inheriting it: anything that is not a number in 4..7 gets no 全文 code.
 */
export function deliversFullText(grade: string | number | undefined | null): boolean {
  const n = typeof grade === 'number' ? grade : Number.parseInt(grade ?? '', 10);
  return Number.isInteger(n) && n >= 4 && n <= 7;
}

export function buildLessonQrValue(
  origin: string,
  lessonId: number | string,
  step: LessonQrStep,
  /** 這一節**自己的**代號（不是它引用的課文）。有就印短網址。 */
  sectionSlug?: string | null,
): string {
  // 紙上只印一個不帶語意的代號：`/q/9a7x4`（#2916）。
  //
  // 長網址 `/learn/{id}/{step}?p={slug}` 把四樣東西焊死在紙上 ——
  // 網域、路由名、課的流水號、篇次 —— 而這四樣 2026-08 全都動過。
  // QR 印進學習單、貼在教室，那張紙收不回來，所以紙上不可以有
  // 任何我們還會改的東西。代號永不變，目的地是我們這邊的設定。
  if (sectionSlug) return `${origin}/q/${sectionSlug}`;
  // ⛔ **沒有代號就不出 QR**（owner 2026-08-25：「每一個 QR code 都是一組 QR slug url」）。
  //
  // 這裡本來退回長網址。退回是無聲的：QR 掃得開、頁面也對，
  // 只是把課號跟路由名印在紙上 —— 而那正是這整層要消除的東西。
  // 2026-08-25 實測：訪客頁沒把代號傳下來，四個情境全部靜靜地印了長網址。
  // 回空字串讓呼叫端看得見「這一節沒有代號」，而不是拿到一個看似正常的網址。
  return '';
}

/**
 * QR 要印的入口網域。
 *
 * ⛔ **不要傳 `window.location.origin`。** 那會讓「在哪個站按下載」決定紙上印什麼 ——
 * 2026-08-25 查出 PM 在 staging 產的那批 QR **每一張都指向測試站**，
 * 學生掃進去用測試站登入、學習歷程留在測試站。那不是設定失誤，
 * 是「用當下網址當印刷內容」這個設計保證會發生的事。
 */
export const QR_ENTRY_ORIGIN =
  (import.meta.env.VITE_QR_ENTRY_ORIGIN as string | undefined)?.replace(/\/$/, '')
  || 'https://lingoleap-prod.web.app';

export function qrFileName(filePrefix: string, lessonId: number | string): string {
  return `${filePrefix}-L${String(lessonId).padStart(2, '0')}.png`;
}

export async function qrCodeToDataUrl(value: string): Promise<string> {
  // Plain static import of `qrcode` (see the top of this file). This was once
  // `await import(/* @vite-ignore */ moduleName)` with the name in a variable,
  // which tells Vite not to analyse or bundle the module: the build succeeded
  // with the package absent, the unit test passed because it mocks 'qrcode',
  // and in a real browser the bare specifier could not be resolved, so every
  // QR download threw. Verified by grepping the build output for the library's
  // own strings — zero hits before, present after.
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
}

export function triggerDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
}

/**
 * Does this lesson get a 段落 code?
 *
 * Same rule the admin table applies when it decides whether to emit a
 * `passage_url`: only when the lesson actually has a 念順順段. Both surfaces
 * ask through this function rather than each testing the field, so the two
 * cannot answer differently.
 */
export function hasKeyPassage(story: { keyReading?: { passage?: string } | null }): boolean {
  return Boolean(story.keyReading?.passage?.trim());
}
