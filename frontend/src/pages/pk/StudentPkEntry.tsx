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
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyEnrolledClassrooms, type StudentEnrolledClassroom } from '../../services/learning/session';
import { createPkInvite, joinPkQueue, PkApiError, type PkScopeType } from '../../services/pkApi';

type Scope = { type: PkScopeType; ref: string; label: string };

const StudentPkEntry: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lessonUid = searchParams.get('lessonUid');
  const lessonTitle = searchParams.get('lessonTitle');

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
  const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        const active = res.classrooms.find((c) => c.is_active) ?? res.classrooms[0] ?? null;
        setClassroom(active);
        setCanFindClassmate(res.classrooms.some((c) => c.pk_human));
      })
      .finally(() => setLoaded(true));
  }, [token]);

  const currentScope: Scope | null =
    scopeChoice === 'lesson' && lessonUid
      ? { type: 'lesson', ref: lessonUid, label: lessonTitle ?? '這一課' }
      : classroom?.grade != null
        ? { type: 'grade_pool', ref: String(classroom.grade), label: `${classroom.grade} 年級題庫` }
        : null;

  const handleFindClassmate = async () => {
    if (!token || !currentScope) return;
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
    if (!currentScope) return;
    const qs = new URLSearchParams({
      scopeType: currentScope.type,
      scopeRef: currentScope.ref,
      ...(classroom?.id != null ? { classroomId: String(classroom.id) } : {}),
    });
    navigate(`/pk/opponents?${qs.toString()}`);
  };

  const handleRedeemInvite = async () => {
    if (!token || !currentScope || inviteCodeInput.trim().length !== 6) return;
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
    if (!token || !classroom?.id || !currentScope) return;
    setBusy(true);
    setError('');
    try {
      const res = await createPkInvite(token, {
        scope_type: currentScope.type,
        scope_ref: currentScope.ref,
        classroom_id: classroom.id,
      });
      setCreatedInviteCode(res.invite_code);
    } catch (err) {
      setError(err instanceof PkApiError ? err.message : '發生錯誤，請重試');
    } finally {
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
      <h1 className="text-2xl font-bold text-on-surface">PK 對戰</h1>
      <p className="mt-1 text-sm text-on-surface-variant">一對一，隨時挑戰同學或文學家</p>

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

      {!currentScope && (
        <p className="mt-8 max-w-xs text-center text-sm text-on-surface-variant">
          還沒有加入班級，先加入班級才能使用 PK 對戰喔。
        </p>
      )}

      {currentScope && (
        <>
          <div className="mt-10 flex w-full max-w-sm flex-col gap-4">
            {canFindClassmate && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFindClassmate()}
                className="rounded-2xl bg-accent px-6 py-6 text-lg font-bold text-white shadow active:scale-95 transition-transform disabled:opacity-50"
              >
                找同學 PK
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={handleChallengeFigure}
              className="rounded-2xl border-2 border-accent px-6 py-6 text-lg font-bold text-accent active:scale-95 transition-transform disabled:opacity-50"
            >
              挑戰文學家
            </button>
          </div>

          {canFindClassmate && classroom?.id != null && currentScope.type !== undefined && (
            <div className="mt-6 w-full max-w-sm space-y-2 text-sm">
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
                  {createdInviteCode ? (
                    <p className="text-2xl font-bold tracking-widest text-accent">{createdInviteCode}</p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleCreateInvite()}
                      className="rounded-lg bg-accent px-4 py-2 font-semibold text-white"
                    >
                      產生邀請碼
                    </button>
                  )}
                  {createdInviteCode && (
                    <p className="mt-1 text-xs text-on-surface-variant">5 分鐘內有效，告訴同學這組代碼</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="mt-4 text-sm text-error">{error}</p>}
    </div>
  );
};

export default StudentPkEntry;
