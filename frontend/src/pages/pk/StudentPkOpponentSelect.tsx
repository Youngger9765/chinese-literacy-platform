/**
 * StudentPkOpponentSelect — `/pk/opponents` (PRD §3.1 step 3/§5.2).
 *
 * 7 figure cards side by side; the one whose virtual rating is closest to
 * the student's current (hidden) rating gets a "推薦挑戰" badge, but every
 * card is clickable regardless — recommendation, never a hard gate (§5.2).
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { challengePkAi, getPkOpponents, PkApiError, type PkOpponent, type PkScopeType } from '../../services/pkApi';

const StudentPkOpponentSelect: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scopeType = (searchParams.get('scopeType') ?? 'grade_pool') as PkScopeType;
  const scopeRef = searchParams.get('scopeRef') ?? '';
  const classroomIdParam = searchParams.get('classroomId');
  const classroomId = classroomIdParam != null ? Number(classroomIdParam) : null;

  const [opponents, setOpponents] = useState<PkOpponent[] | null>(null);
  const [error, setError] = useState('');
  const [busyTier, setBusyTier] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    getPkOpponents(token)
      .then((res) => setOpponents(res.opponents))
      .catch((err) => setError(err instanceof PkApiError ? err.message : '載入失敗'));
  }, [token]);

  const handlePick = async (opp: PkOpponent) => {
    if (!token || !scopeRef || busyTier != null) return;
    setBusyTier(opp.tier);
    setError('');
    try {
      const res = await challengePkAi(token, {
        scope_type: scopeType,
        scope_ref: scopeRef,
        bot_tier: opp.tier,
        classroom_id: classroomId,
      });
      navigate(`/pk/match/${res.match_id}`, {
        state: { opponentType: 'ai', tier: opp.tier, firstTime: !opp.previously_played },
      });
    } catch (err) {
      setError(err instanceof PkApiError ? err.message : '發生錯誤，請重試');
      setBusyTier(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-5 py-8">
      <h1 className="text-xl font-bold text-on-surface">選一位對手</h1>
      <p className="mt-1 text-sm text-on-surface-variant">7 位文學家，等你來挑戰</p>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}

      {!opponents ? (
        <div className="mt-10 h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      ) : (
        <div className="mt-6 grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          {opponents.map((opp) => (
            <button
              key={opp.tier}
              type="button"
              disabled={busyTier != null}
              onClick={() => void handlePick(opp)}
              className={[
                'relative flex flex-col items-center gap-2 rounded-2xl border-2 bg-surface-container-lowest p-4 shadow-sm transition-transform active:scale-95 disabled:opacity-50',
                opp.recommended ? 'border-accent' : 'border-transparent',
              ].join(' ')}
            >
              {opp.recommended && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white whitespace-nowrap">
                  推薦挑戰
                </span>
              )}
              <img src={opp.icon_url} alt={opp.name} className="h-12 w-12" />
              <span className="text-sm font-semibold text-on-surface">{opp.name}</span>
              <span className="text-xs text-on-surface-variant">{opp.speed_label}</span>
              {opp.unlocked && (
                <span className="rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-bold text-accent">已解鎖</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentPkOpponentSelect;
