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

export function buildLessonQrValue(origin: string, lessonId: number | string, step: LessonQrStep): string {
  return `${origin}/learn/${lessonId}/${step}`;
}

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
