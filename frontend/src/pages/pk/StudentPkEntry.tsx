/**
 * StudentPkEntry — `/pk` (PRD §3.1 step 1/2/3).
 *
 * Two entry points funnel here (§3.1 step 1): (a) a lesson's conclusion
 * page with `?lessonUid=&lessonTitle=` ("剛讀完的這課" becomes an option),
 * (b) the persistent sidebar entry with no query params ("我的年級題庫"
 * only — no "this lesson" context). Subtitle text is fixed per §2.1:
 * "一對一，隨時挑戰同學或文學家".
 *
 * Full-screen game surface (§3.3) — no AppShell.
 *
 * #3747 (Young, 2026-10-24): "畫面太隨便了，也沒有解說或是圖像 banner 之類
 * 的，也要有回到上一頁的按鈕啊！！！！ 或是過去的戰績表現啊" — this screen
 * had a title + one line of subtitle and nothing else. Added below: a back
 * button to 遊戲區 (GameBackButton — this page has no AppShell sidebar to
 * fall back on), a "怎麼玩" explanation card, and a 戰績 panel wired to the
 * existing `/api/pk/history` + `/api/pk/rating/me` endpoints (the backend
 * has carried these since #3586/#3602; nothing ever rendered them).
 *
 * #3761 (round 3, Young reviewed #3756's screenshots): "大半畫面空白，不像
 * 遊戲" — the #3756 banner was a single small gradient card with one icon.
 * Replaced with `PkHeroBanner` (all 7 figures line up, icon-based "怎麼玩"
 * steps) and widened the page from `max-w-sm` to `max-w-2xl` so it actually
 * uses desktop width instead of staying phone-width on a 1440px screen.
 *
 * round 4 (Young: "頁面下半一半空白...桌機請把戰績/七位文學家進度放大成
 * 可點的頭像卡牆"): widened again to `max-w-4xl` — the banner's 7-figure
 * row was actually overflowing its `max-w-2xl` container (see
 * PkHeroBanner's docstring for the clipping bug that caused), and a wider
 * page gives the enlarged defeat-roster grid (PkHistoryPanel) room to
 * breathe instead of wrapping into a cramped single column.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyEnrolledClassrooms, type StudentEnrolledClassroom } from '../../services/learning/session';
import { createPkInvite, joinPkQueue, PkApiError, type PkScopeType } from '../../services/pkApi';
import { resolveGradeForAiPk } from './resolvePkGrade';
import GameBackButton from '../../components/game/GameBackButton';
import PkHistoryPanel from '../../components/pk/PkHistoryPanel';
import PkHeroBanner from '../../components/pk/PkHeroBanner';

type Scope = { type: PkScopeType; ref: string; label: string };

const StudentPkEntry: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lessonUid = searchParams.get('lessonUid');
  const lessonTitle = searchParams.get('lessonTitle');

  // issue #3602 B1: the raw list is kept (not just the one "active"
  // classroom) because resolving a grade for AI PK needs to look across
  // ALL enrolled classrooms, not just whichever one happens to be active.
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [studentGrade, setStudentGrade] = useState<number | null>(null);
  const [classroom, setClassroom] = useState<StudentEnrolledClassroom | null>(null);
  // issue #3586 §7.4 (final): 真人 PK (找同學 PK + 邀請碼) is gated per
  // classroom via `pk_human`; a student in several classes should see the
  // entry if ANY of them has it on — this is a deliberate, documented
  // product call (the instruction that introduced this flag left the
  // multi-classroom case to be "decided and documented" rather than
  // specifying it), not a default FastAPI/Pydantic behavior. AI PK
  // (挑戰文學家) has no such flag anywhere and is never hidden.
  const [canFindClassmate, setCanFindClassmate] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scopeChoice, setScopeChoice] = useState<'lesson' | 'grade_pool'>(lessonUid ? 'lesson' : 'grade_pool');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showInviteRedeem, setShowInviteRedeem] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [showInviteCreate, setShowInviteCreate] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        // #3602 B1: prefer whichever classroom has 真人 PK turned on (that's
        // the one handleFindClassmate/handleCreateInvite will actually bind
        // the request to) — falling back to "active, then first" only when
        // none does, same as before.
        const pkHumanClassroom = res.classrooms.find((c) => c.pk_human) ?? null;
        const active = res.classrooms.find((c) => c.is_active) ?? res.classrooms[0] ?? null;
        setClassrooms(res.classrooms);
        setClassroom(pkHumanClassroom ?? active);
        setCanFindClassmate(res.classrooms.some((c) => c.pk_human));
        setStudentGrade(res.student_grade);
      })
      .finally(() => setLoaded(true));
  }, [token]);

  // #3602 B1: AI PK (挑戰文學家) must work for every logged-in student
  // "regardless of class" (Young 2026-10-16) — resolving a grade no longer
  // depends solely on the one `classroom` chosen above having a grade set.
  // See resolvePkGrade.ts for the full fallback order and why.
  const resolvedGrade = resolveGradeForAiPk(classrooms, classroom?.grade ?? null, studentGrade);

  const currentScope: Scope =
    scopeChoice === 'lesson' && lessonUid
      ? { type: 'lesson', ref: lessonUid, label: lessonTitle ?? '這一課' }
      : { type: 'grade_pool', ref: String(resolvedGrade), label: `${resolvedGrade} 年級題庫` };

  const handleFindClassmate = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const res = await joinPkQueue(token, {
        scope_type: currentScope.type,
        scope_ref: currentScope.ref,
        classroom_id: classroom?.id ?? null,
      });
      navigate(`/pk/queue/${res.queue_id}`, {
        state: { scopeType: currentScope.type, scopeRef: currentScope.ref, classroomId: classroom?.id ?? null },
      });
    } catch (err) {
      setError(err instanceof PkApiError ? err.message : '發生錯誤，請重試');
      setBusy(false);
    }
  };

  const handleChallengeFigure = () => {
    const qs = new URLSearchParams({
      scopeType: currentScope.type,
      scopeRef: currentScope.ref,
      ...(classroom?.id != null ? { classroomId: String(classroom.id) } : {}),
    });
    navigate(`/pk/opponents?${qs.toString()}`);
  };

  const handleRedeemInvite = async () => {
    if (!token || inviteCodeInput.trim().length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const res = await joinPkQueue(token, {
        scope_type: currentScope.type,
        scope_ref: currentScope.ref,
        invite_code: inviteCodeInput.trim().toUpperCase(),
      });
      navigate(`/pk/queue/${res.queue_id}`, {
        state: { scopeType: currentScope.type, scopeRef: currentScope.ref, classroomId: classroom?.id ?? null },
      });
    } catch (err) {
      setError(err instanceof PkApiError ? err.message : '邀請碼無效，請確認後重試');
      setBusy(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!token || !classroom?.id) return;
    setBusy(true);
    setError('');
    try {
      const res = await createPkInvite(token, {
        scope_type: currentScope.type,
        scope_ref: currentScope.ref,
        classroom_id: classroom.id,
      });
      // #3602 B4: the creator used to just stash the code in local state and
      // sit on THIS page forever — queue_id was returned but never used, so
      // when the friend redeemed the code, the creator had no way to find
      // out the match had started. Navigate into the same queue-wait screen
      // handleFindClassmate uses (it already polls queue_id and redirects to
      // /pk/match/{id} once status flips to "matched" — redeem_invite sets
      // exactly that on THIS queue row). Pass the code along so the wait
      // screen can still show it to the creator while they wait.
      navigate(`/pk/queue/${res.queue_id}`, {
        state: {
          scopeType: currentScope.type,
          scopeRef: currentScope.ref,
          classroomId: classroom.id,
          inviteCode: res.invite_code,
        },
      });
    } catch (err) {
      setError(err instanceof PkApiError ? err.message : '發生錯誤，請重試');
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="載入中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-6 py-10">
      <div className="w-full max-w-4xl">
        <GameBackButton to="/game-hub" />
      </div>

      <div className="mt-4 w-full max-w-4xl">
        <PkHeroBanner />
      </div>

      {lessonUid && (
        <div className="mt-6 flex gap-2 rounded-full bg-surface-container p-1 text-sm">
          <button
            type="button"
            onClick={() => setScopeChoice('lesson')}
            className={`rounded-full px-4 py-1.5 font-medium ${
              scopeChoice === 'lesson' ? 'bg-accent text-white' : 'text-on-surface-variant'
            }`}
          >
            剛讀完的這課
          </button>
          <button
            type="button"
            onClick={() => setScopeChoice('grade_pool')}
            className={`rounded-full px-4 py-1.5 font-medium ${
              scopeChoice === 'grade_pool' ? 'bg-accent text-white' : 'text-on-surface-variant'
            }`}
          >
            我的年級題庫
          </button>
        </div>
      )}

      {/* #3602 B1: this is now purely informational — it no longer blocks
          挑戰文學家, which always has a resolved scope (see resolvedGrade
          above). It only explains why 找同學 PK isn't offered. */}
      {classrooms.length === 0 && (
        <p className="mt-8 max-w-xs text-center text-sm text-on-surface-variant">
          還沒有加入班級，加入班級後就能找同學 PK 囉！現在可以先挑戰文學家。
        </p>
      )}

      {/* #3761: bigger, more prominent CTAs (taller + larger text than
          #3756's version) in a side-by-side pair on wide screens so they
          read as two equally-weighted choices instead of a stacked list.
          round 4 (Young: "主按鈕「挑戰文學家」是白底細框，應該是實心主色
          大按鈕"): when it's the ONLY button (找同學 PK 不可用，多數學生
          沒加入開啟真人 PK 的班級時就是這個情況) it's now solid-filled
          like 找同學 PK — an outline button as the SOLE call-to-action
          read as weak/secondary. When both buttons show, 挑戰文學家 stays
          the outline/secondary style so 找同學 PK still reads as primary. */}
      <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        {canFindClassmate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleFindClassmate()}
            className="rounded-2xl bg-accent px-6 py-8 text-xl font-bold text-white shadow-md active:scale-95 transition-transform disabled:opacity-50"
          >
            找同學 PK
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={handleChallengeFigure}
          className={`rounded-2xl px-6 py-8 text-xl font-bold active:scale-95 transition-transform disabled:opacity-50 ${
            canFindClassmate
              ? 'border-2 border-accent text-accent'
              : 'sm:col-span-2 bg-accent text-white shadow-md'
          }`}
        >
          挑戰文學家
        </button>
      </div>

      {canFindClassmate && classroom?.id != null && (
        <div className="mt-6 w-full max-w-3xl space-y-2 text-sm">
          <button
            type="button"
            onClick={() => setShowInviteRedeem((v) => !v)}
            className="text-accent underline"
          >
            有邀請碼嗎？
          </button>
          {showInviteRedeem && (
            <div className="flex gap-2">
              <input
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="輸入 6 碼邀請碼"
                className="flex-1 rounded-lg border border-surface-dim px-3 py-2 uppercase tracking-widest"
                maxLength={6}
              />
              <button
                type="button"
                disabled={busy || inviteCodeInput.length !== 6}
                onClick={() => void handleRedeemInvite()}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-40"
              >
                加入
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowInviteCreate((v) => !v)}
            className="block text-accent underline"
          >
            產生邀請碼給同學
          </button>
          {showInviteCreate && (
            <div className="rounded-lg bg-surface-container px-4 py-3 text-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateInvite()}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                產生邀請碼
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      {token && <PkHistoryPanel token={token} onChallenge={handleChallengeFigure} />}
    </div>
  );
};

export default StudentPkEntry;
