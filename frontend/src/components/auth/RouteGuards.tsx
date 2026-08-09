import React, { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPublicLearningStep } from '../../config/stepConfig';

const GuestReadingPage = lazy(() => import('../../pages/GuestReadingPage'));

const AuthLoadingSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-amber-50">
    <div className="flex flex-col items-center gap-3" role="status" aria-label="載入中，請稍候">
      <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      <span className="text-sm text-gray-400">載入中...</span>
    </div>
  </div>
);

/** Redirect authenticated users away from auth pages. */
export const PublicOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <AuthLoadingSpinner />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
};

/** Redirect unauthenticated users to /login. Redirect ToS-pending users to /terms. */
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, needsTermsAcceptance } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;

  // ToS gate: redirect to /terms if user hasn't accepted yet (except when already on /terms)
  if (needsTermsAcceptance && location.pathname !== '/terms') {
    return <Navigate to="/terms" replace />;
  }

  return <>{children}</>;
};

/**
 * Gate for the /learn/:storyId subtree (#2649).
 *
 * Identical to ProtectedRoute, with one hole: an anonymous visitor on a step
 * listed in PUBLIC_LEARNING_STEPS gets the standalone guest reader instead of a
 * redirect to /login. That is the QR-code path — paper worksheet, no account.
 *
 * The guest reader is deliberately a *different* component, not the shell with
 * bits hidden. The authenticated shell creates DB learning sessions on mount;
 * mounting it without a user would fire authenticated calls that 401.
 *
 * Mutation checks (each must turn a test red):
 *   - drop the isPublicLearningStep() call  → anonymous QR visitor hits /login
 *   - gate on `isLoading` after the guest branch → guest reader flashes at a
 *     signed-in user during the auth handshake
 *   - let the guest branch run when authenticated → signed-in students lose
 *     annotating entirely
 */
export const LearningRouteGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, needsTermsAcceptance } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingSpinner />;

  if (!isAuthenticated) {
    // /learn/:storyId/:step — the step is the third segment.
    const step = location.pathname.split('/')[3] ?? '';
    if (isPublicLearningStep(step)) {
      return (
        <Suspense fallback={<AuthLoadingSpinner />}>
          <GuestReadingPage />
        </Suspense>
      );
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (needsTermsAcceptance && location.pathname !== '/terms') {
    return <Navigate to="/terms" replace />;
  }

  return <>{children}</>;
};

/**
 * Issue #457: redirect student users without a classroom to /no-teacher.
 *
 * Only active when teacherGatingEnforced is true (ENFORCE_TEACHER_GATING env var).
 * Teachers, admins, and other non-student roles are never gated.
 * The /no-teacher, /join, /profile, and /change-password pages are exempt
 * so the user can still join a classroom or manage their account.
 */
export const StudentClassroomGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, hasClassroom, teacherGatingEnforced } = useAuth();
  const location = useLocation();

  // Exempt paths — always accessible even without a classroom
  const exemptPaths = ['/no-teacher', '/join', '/profile', '/change-password', '/privacy', '/help'];
  const isExempt = exemptPaths.some((p) => location.pathname.startsWith(p));

  if (isLoading) return <AuthLoadingSpinner />;

  if (
    isAuthenticated &&
    teacherGatingEnforced &&
    !hasClassroom &&
    !isExempt
  ) {
    return <Navigate to="/no-teacher" replace />;
  }

  return <>{children}</>;
};
