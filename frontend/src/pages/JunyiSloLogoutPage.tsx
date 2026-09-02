import React, { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clearAuthSession } from '../utils/storage';
import { isAllowedSloContinue } from '../utils/sloParticipants';

/** Indirection so tests can assert the redirect target without a real nav. */
export const sloNavigation = {
  replace(url: string): void {
    window.location.replace(url);
  },
};

/**
 * JunyiSloLogoutPage — Junyi Single Logout (SLO) endpoint for LingoLeap.
 *
 * Public URL registered on Junyi as this RP's `SsoClientConfig.logout_url`
 * (e.g. https://lingoleap-prod.web.app/junyi-slo-logout). During Junyi's logout
 * flow the browser is driven here as a top-level GET navigation, one hop in a
 * sequential redirect chain across all SLO participants
 * (doc/THIRD_PARTY_SSO.md §6.2).
 *
 * LingoLeap's credential is a localStorage JWT (`lingoleap_token`), NOT a
 * cookie, so a pure backend 302/Set-Cookie could not clear it — this must be an
 * SPA route whose JS runs. On mount we:
 *   1. Clear LingoLeap's own session (JWT + Junyi flag + learning sessionStorage)
 *      via clearAuthSession(). Idempotent: succeeds even if already logged out.
 *   2. Read `continue` (precomputed by Junyi to point at the NEXT station),
 *      validate it against the SLO participant allowlist, and redirect there.
 *      On a missing/invalid `continue`, fall back to LingoLeap's /login.
 *
 * We deliberately never redirect back to Junyi /logout: `continue` already
 * points onward, and a dedicated SLO route avoids the UI logout's Junyi bounce.
 */
const JunyiSloLogoutPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const done = useRef(false);
  const continueUrl = searchParams.get('continue');

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    clearAuthSession();

    const target = continueUrl && isAllowedSloContinue(continueUrl)
      ? continueUrl
      : `${window.location.origin}/login`;
    sloNavigation.replace(target);
  }, [continueUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-10 h-10 border-4 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-gray-600 text-sm">正在登出...</p>
      </div>
    </div>
  );
};

export default JunyiSloLogoutPage;
