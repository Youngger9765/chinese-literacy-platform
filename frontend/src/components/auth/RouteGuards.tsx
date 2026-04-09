import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

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

/** Redirect unauthenticated users to /login. */
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;

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
