/**
 * App.tsx — root component.
 *
 * Thin shell that wires together the router, auth provider, and route tree.
 * All route definitions live in routes/AppRoutes.tsx.
 * Auth guards live in components/auth/RouteGuards.tsx.
 * The app chrome (header/sidebar) lives in components/layout/AppShell.tsx.
 * Small inline page components live in pages/app/InlinePages.tsx.
 */
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { LearningNavProvider } from './contexts/LearningNavContext';
import { ZhuyinProvider } from './context/ZhuyinContext';
import { KaraokeProvider } from './context/KaraokeContext';
import TermsGate from './components/auth/TermsGate';
import AppRoutes from './routes/AppRoutes';

/** Root component with router and auth. */
const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <WorkspaceProvider>
            <LearningNavProvider>
              <ZhuyinProvider>
                <KaraokeProvider>
                  <TermsGate>
                    <AppRoutes />
                  </TermsGate>
                </KaraokeProvider>
              </ZhuyinProvider>
            </LearningNavProvider>
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
