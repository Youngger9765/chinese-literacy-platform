/**
 * classroomJoinQr — the one place that decides what a classroom-join QR
 * points at (#3081).
 *
 * ## Why this exists separately from lessonQr.ts
 *
 * lessonQr.ts already solved "how do we turn a URL into a scannable PNG
 * without leaking the current tab's origin into the printed/projected
 * output" for the lesson QR flow. That mistake (using `window.location.origin`)
 * shipped once already and was traced to PM-produced QR codes that pointed at
 * staging (see `lessonQr.ts`'s own history). Re-deriving the origin logic here
 * would be a second place that could drift from the fix, so this module
 * reuses `QR_ENTRY_ORIGIN` / `qrCodeToDataUrl` from lessonQr.ts and only adds
 * the bit that's actually different: the URL shape.
 *
 * ## What the URL is
 *
 * `{origin}/join?code=XXXXXX` — the ordinary "加入班級" route
 * (`frontend/src/pages/JoinClassroomPage.tsx`), already reachable from the
 * student sidebar. A visitor who scans this and isn't logged in hits
 * `ProtectedRoute`'s redirect to `/login` with `state.from` set, then bounces
 * back to `/join?code=XXXXXX` after signing in (#3081 AC3).
 *
 * Unlike the lesson QR's `/q/{slug}` short links, this one does NOT need a
 * server-side slug redirect: `join_code` already IS the short, stable,
 * printable identifier (6 chars, teacher-controlled, regenerable). Adding a
 * second layer of indirection here would only be indirection for its own
 * sake.
 */
import { QR_ENTRY_ORIGIN, qrCodeToDataUrl } from './lessonQr';

export { QR_ENTRY_ORIGIN, qrCodeToDataUrl };

/**
 * Build the URL a classroom-join QR should encode.
 *
 * ⛔ Callers must pass `QR_ENTRY_ORIGIN`, never `window.location.origin`.
 * That's a parameter (not read from inside this function) so a unit test can
 * assert the call site got it right without needing a browser `window`.
 */
export function buildClassroomJoinQrValue(origin: string, joinCode: string): string {
  return `${origin}/join?code=${encodeURIComponent(joinCode)}`;
}
