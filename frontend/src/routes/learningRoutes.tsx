/**
 * learningRoutes.tsx — generated learning step routes derived from STEP_CONFIG.
 *
 * ## Why this exists (Issue #1891)
 *
 * AppRoutes.tsx previously duplicated step order and nextPath data that already
 * lives in STEP_CONFIG / DEFAULT_STEP_SEQUENCE.  A maintenance problem:
 *   - Adding / removing a step required edits in TWO places.
 *   - nextPath was hardcoded and could diverge from DEFAULT_STEP_SEQUENCE.
 *
 * This module is the single source of truth for how learning steps map to
 * React Router <Route> elements.  It derives nextPath from resolveActiveSteps()
 * so the route table stays in sync with stepConfig automatically.
 *
 * ## Page component lookup map
 *
 * We maintain a typed map from step id → lazy component.  Every step registered
 * in STEP_REGISTRY must have a corresponding entry here (or it will log a warning
 * and be skipped at route generation time).
 *
 * ## StepEnabledGuard
 *
 * Steps with `enabled: false` in STEP_REGISTRY are still routable (e.g. via
 * ToolPicker deep-links).  The StepEnabledGuard wraps disabled-step routes so
 * that any direct navigation redirects to the first enabled step instead.
 *
 * ## Public API
 *
 * - `learningRoutes` — array of <Route> JSX elements for the /learn/:storyId nested router.
 *   Consume via: `<Route path="/learn/:storyId" element={...}>{learningRoutes}</Route>`
 */
import React, { lazy } from 'react';
import { Route, Navigate, useNavigate, useParams } from 'react-router-dom';

import StepErrorBoundary from '../components/StepErrorBoundary';
import { resolveActiveSteps, STEP_REGISTRY, DEFAULT_STEP_SEQUENCE, StepConfig } from '../config/stepConfig';

// ---------------------------------------------------------------------------
// Lazy page imports — one chunk per step (code splitting preserved)
// ---------------------------------------------------------------------------

const IntroPage               = lazy(() => import('../pages/learning/IntroPage'));
const TutorPage               = lazy(() => import('../pages/learning/TutorPage'));
const ComprehensionMcqPage    = lazy(() => import('../pages/learning/ComprehensionMcqPage'));
const StoryStructurePage      = lazy(() => import('../pages/learning/StoryStructurePage'));
const StrategyExercisePage    = lazy(() => import('../pages/learning/StrategyExercisePage'));
const VocabPage               = lazy(() => import('../pages/learning/VocabPage'));
const DictationPage           = lazy(() => import('../pages/learning/DictationPage'));
const ListeningPage           = lazy(() => import('../pages/learning/ListeningPage'));
const FullReadingPage         = lazy(() => import('../pages/learning/FullReadingPage'));
const ReportPage              = lazy(() => import('../pages/learning/ReportPage'));
const ReadingAnnotationPage   = lazy(() => import('../pages/learning/ReadingAnnotationPage'));
const VocabApplicationPage    = lazy(() => import('../pages/learning/VocabApplicationPage'));
const VocabDefinitionMatchPage = lazy(() => import('../pages/learning/VocabDefinitionMatchPage'));
const VocabWordSearchPage     = lazy(() => import('../pages/learning/VocabWordSearchPage'));
const KnowledgeStationPage    = lazy(() => import('../pages/learning/KnowledgeStationPage'));
const SentencePracticePage    = lazy(() => import('../pages/learning/SentencePracticePage'));

// ---------------------------------------------------------------------------
// stepPageMap — step id → React component
// All ids from STEP_REGISTRY must be present here.
// ---------------------------------------------------------------------------

type LazyPage = React.LazyExoticComponent<React.ComponentType>;

const STEP_PAGE_MAP: Record<string, LazyPage> = {
  'lesson-intro':                 IntroPage,
  'full-text-annotate':    ReadingAnnotationPage,
  'paragraph-reading':                 TutorPage,
  'key-passage-reading':          FullReadingPage, // 2026-07-20 label 改為「重點朗讀」；Phase 1 接 key_reading 後唸指定段
  'listening':             ListeningPage,
  'character-practice':                 VocabPage,
  'vocab-definition':      VocabDefinitionMatchPage,
  'vocab-application':     VocabApplicationPage,
  'keypoints-table':       StoryStructurePage,
  'spotlight':      StrategyExercisePage,
  'sentence-practice':     SentencePracticePage,
  'comprehension':         ComprehensionMcqPage,
  'vocab-review':     VocabWordSearchPage,
  'dictation':             DictationPage,
  'knowledge-station':     KnowledgeStationPage,
  'report':                ReportPage,
};

// ---------------------------------------------------------------------------
// StepRoute — wraps a learning step page in StepErrorBoundary.
// The `nextPath` prop wires the "跳過此步驟" button to navigate to the next step.
// Extracted here to co-locate with the route generation logic.
// ---------------------------------------------------------------------------

interface StepRouteProps {
  stepLabel: string;
  nextPath?: string;
  children: React.ReactNode;
}

const StepRoute: React.FC<StepRouteProps> = ({ stepLabel, nextPath, children }) => {
  const navigate = useNavigate();
  const handleSkip = nextPath ? () => navigate(nextPath, { replace: true }) : undefined;

  return (
    <StepErrorBoundary stepLabel={stepLabel} onSkip={handleSkip}>
      {children}
    </StepErrorBoundary>
  );
};

// ---------------------------------------------------------------------------
// StepEnabledGuard — redirects to the first enabled step when a step is disabled
// in STEP_CONFIG (enabled: false).  Wrap any route whose step may be disabled.
// ---------------------------------------------------------------------------

interface StepEnabledGuardProps {
  stepId: string;
  children: React.ReactNode;
}

const StepEnabledGuard: React.FC<StepEnabledGuardProps> = ({ stepId, children }) => {
  const { storyId } = useParams<{ storyId: string }>();
  const step = STEP_REGISTRY[stepId];

  if (step && !step.enabled) {
    const fallbackId = resolveActiveSteps()[0]?.id ?? 'full-text-annotate';
    return <Navigate to={`/learn/${storyId ?? ''}/${fallbackId}`} replace />;
  }

  return <>{children}</>;
};

// ---------------------------------------------------------------------------
// buildLearningRoutes — derive <Route> elements from STEP_REGISTRY + DEFAULT_STEP_SEQUENCE
//
// Algorithm:
//   1. Iterate DEFAULT_STEP_SEQUENCE (preserves route ordering).
//   2. For each stepId, look up the page component in STEP_PAGE_MAP.
//   3. Compute nextPath = next ENABLED step in resolveActiveSteps().
//      (disabled steps are skipped when computing nextPath so skip
//       navigates to the next visible step, not to a disabled one.)
//   4. Disabled steps get wrapped in StepEnabledGuard (redirect to fallback).
//   5. Steps with no page mapping are silently skipped (future-proof for
//      steps added to STEP_REGISTRY before a page is built).
// ---------------------------------------------------------------------------

function buildLearningRoutes(): React.ReactElement[] {
  const enabledSteps = resolveActiveSteps();

  // Build a lookup: stepId → next enabled stepId
  const nextEnabledStepId: Record<string, string | undefined> = {};
  for (let i = 0; i < enabledSteps.length - 1; i++) {
    nextEnabledStepId[enabledSteps[i].id] = enabledSteps[i + 1].id;
  }

  const routes: React.ReactElement[] = [];

  for (const stepId of DEFAULT_STEP_SEQUENCE) {
    const step: StepConfig | undefined = STEP_REGISTRY[stepId];
    const PageComponent = STEP_PAGE_MAP[stepId];

    if (!step || !PageComponent) {
      // Step in sequence but no page component yet — skip
      continue;
    }

    const nextPath = nextEnabledStepId[stepId];
    const stepElement = (
      <StepRoute stepLabel={step.label} nextPath={nextPath}>
        <PageComponent />
      </StepRoute>
    );

    const routeElement = step.enabled ? (
      stepElement
    ) : (
      <StepEnabledGuard stepId={stepId}>
        {stepElement}
      </StepEnabledGuard>
    );

    routes.push(
      <Route key={stepId} path={stepId} element={routeElement} />
    );
  }

  return routes;
}

// ---------------------------------------------------------------------------
// learningRoutes — the public export.
// Evaluated once at module load time; immutable thereafter.
// ---------------------------------------------------------------------------

export const learningRoutes: React.ReactElement[] = buildLearningRoutes();
