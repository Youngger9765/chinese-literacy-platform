/**
 * TermsGate — renders TermsModal over the whole app when the authenticated
 * user has not yet accepted the Terms of Service.
 *
 * issue #1918: suppress modal when the /terms page is already rendering its
 * own full-screen consent UI (ProtectedRoute redirects there automatically).
 * Showing both simultaneously causes duplicate UX + double hidden checkboxes.
 *
 * #3412 follow-up: also suppress while a password change is pending.
 * ProtectedRoute forces mustChangePassword users onto /change-password and
 * skips its own ToS check entirely while that's pending -- but this gate is
 * independent and only ever excluded the literal '/terms' path, not
 * '/change-password' and not mustChangePassword itself. A fresh
 * batch-created student has both pending at once, so this opaque,
 * full-viewport modal still painted on TOP of the change-password form,
 * making it physically unreachable until the terms modal was dealt with
 * first -- the exact inversion of the priority ProtectedRoute guarantees.
 * Verified on staging: the modal was covering /change-password end to end.
 */
import React, { Suspense, lazy } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const TermsModal = lazy(() => import('../TermsModal'));

const TermsGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { needsTermsAcceptance, acceptTerms, mustChangePassword } = useAuth();
  const location = useLocation();

  // Do not render modal when the /terms page is already showing the full-screen
  // consent form — ProtectedRoute already redirects there when terms not accepted.
  // Also never render it while a password change is pending (#3412) -- that
  // takes priority over ToS everywhere, not just on the /terms route.
  const shouldShowModal = needsTermsAcceptance && !mustChangePassword && location.pathname !== '/terms';

  return (
    <>
      {children}
      {shouldShowModal && (
        <Suspense fallback={null}>
          <TermsModal
            onAccept={acceptTerms}
            onAccepted={() => {
              // AuthContext already updates user state after acceptTerms resolves.
              // Nothing extra needed here.
            }}
          />
        </Suspense>
      )}
    </>
  );
};

export default TermsGate;
