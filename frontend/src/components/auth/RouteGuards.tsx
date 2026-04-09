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
