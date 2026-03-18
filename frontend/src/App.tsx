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
import { LearningNavProvider } from './contexts/LearningNavContext';
import TermsGate from './components/auth/TermsGate';
import AppRoutes from './routes/AppRoutes';

/** Root component with router and auth. */
const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <LearningNavProvider>
            <TermsGate>
              <AppRoutes />
            </TermsGate>
          </LearningNavProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
