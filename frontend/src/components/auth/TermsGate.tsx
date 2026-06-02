/**
 * TermsGate — renders TermsModal over the whole app when the authenticated
 * user has not yet accepted the Terms of Service.
 *
 * issue #1918: suppress modal when the /terms page is already rendering its
 * own full-screen consent UI (ProtectedRoute redirects there automatically).
 * Showing both simultaneously causes duplicate UX + double hidden checkboxes.
 */
import React, { Suspense, lazy } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const TermsModal = lazy(() => import('../TermsModal'));

const TermsGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { needsTermsAcceptance, acceptTerms } = useAuth();
  const location = useLocation();

  // Do not render modal when the /terms page is already showing the full-screen
  // consent form — ProtectedRoute already redirects there when terms not accepted.
  const shouldShowModal = needsTermsAcceptance && location.pathname !== '/terms';

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
