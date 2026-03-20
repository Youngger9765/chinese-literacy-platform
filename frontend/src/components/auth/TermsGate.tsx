/**
 * TermsGate — renders TermsModal over the whole app when the authenticated
 * user has not yet accepted the Terms of Service.
 */
import React, { Suspense, lazy } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const TermsModal = lazy(() => import('../TermsModal'));

const TermsGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { needsTermsAcceptance, acceptTerms } = useAuth();

  return (
    <>
      {children}
      {needsTermsAcceptance && (
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
