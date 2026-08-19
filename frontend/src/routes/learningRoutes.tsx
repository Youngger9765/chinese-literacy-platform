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
import { resolveActiveSteps, STEP_REGISTRY, DEFAULT_STEP_SEQUENCE, LEGACY_STEP_ID_ALIASES, StepConfig } from '../config/stepConfig';

// ---------------------------------------------------------------------------
// Lazy page imports — one chunk per step (code splitting preserved)
// ---------------------------------------------------------------------------

const IntroPage               = lazy(() => import('../pages/learning/IntroPage'));
const ParagraphReadingPage               = lazy(() => import('../pages/learning/ParagraphReadingPage'));
const ComprehensionMcqPage    = lazy(() => import('../pages/learning/ComprehensionMcqPage'));
const KeypointsTablePage      = lazy(() => import('../pages/learning/KeypointsTablePage'));
const SpotlightPage    = lazy(() => import('../pages/learning/SpotlightPage'));
const CharacterPracticePage               = lazy(() => import('../pages/learning/CharacterPracticePage'));
const DictationPage           = lazy(() => import('../pages/learning/DictationPage'));
const ListeningPage           = lazy(() => import('../pages/learning/ListeningPage'));
const KeyPassageReadingPage         = lazy(() => import('../pages/learning/KeyPassageReadingPage'));
const ReportPage              = lazy(() => import('../pages/learning/ReportPage'));
const FullTextAnnotatePage   = lazy(() => import('../pages/learning/FullTextAnnotatePage'));
const VocabApplicationPage    = lazy(() => import('../pages/learning/VocabApplicationPage'));
const VocabDefinitionMatchPage = lazy(() => import('../pages/learning/VocabDefinitionMatchPage'));
const VocabReviewPage     = lazy(() => import('../pages/learning/VocabReviewPage'));
const KnowledgeStationPage    = lazy(() => import('../pages/learning/KnowledgeStationPage'));
const SentencePracticePage    = lazy(() => import('../pages/learning/SentencePracticePage'));
// 文言文專屬 (#2752)
const ClassicalTextPage             = lazy(() => import('../pages/learning/ClassicalTextPage'));
const ClassicalSentenceMatchingPage = lazy(() => import('../pages/learning/ClassicalSentenceMatchingPage'));
const ClassicalWordMatchingPage     = lazy(() => import('../pages/learning/ClassicalWordMatchingPage'));
const ClassicalSelfChallengePage    = lazy(() => import('../pages/learning/ClassicalSelfChallengePage'));

// ---------------------------------------------------------------------------
// stepPageMap — step id → React component
// All ids from STEP_REGISTRY must be present here.
// ---------------------------------------------------------------------------

type LazyPage = React.LazyExoticComponent<React.ComponentType>;

const STEP_PAGE_MAP: Record<string, LazyPage> = {
  'lesson-intro':                 IntroPage,
  'full-text-annotate':    FullTextAnnotatePage,
  'paragraph-reading':                 ParagraphReadingPage,
  'key-passage-reading':          KeyPassageReadingPage, // 2026-07-20 label 改為「重點朗讀」；Phase 1 接 key_reading 後唸指定段
  'listening':             ListeningPage,
  'character-practice':                 CharacterPracticePage,
  'vocab-definition':      VocabDefinitionMatchPage,
  'vocab-application':     VocabApplicationPage,
  'keypoints-table':       KeypointsTablePage,
  'spotlight':      SpotlightPage,
  'sentence-practice':     SentencePracticePage,
  'comprehension':         ComprehensionMcqPage,
  'vocab-review':     VocabReviewPage,
  'dictation':             DictationPage,
  'knowledge-station':     KnowledgeStationPage,
  'report':                ReportPage,
  // 文言文專屬 (#2752) — not in DEFAULT_STEP_SEQUENCE, only ever reached via a
  // lesson's own step_sequence (see buildLearningRoutes' iteration source below).
  'classical-text':                ClassicalTextPage,
  'classical-sentence-matching':   ClassicalSentenceMatchingPage,
  'classical-word-matching':       ClassicalWordMatchingPage,
  'classical-self-challenge':      ClassicalSelfChallengePage,
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

/** Replaces the legacy segment in place, preserving the storyId and the rest of the URL. */
const LegacyStepRedirect: React.FC<{ to: string }> = ({ to }) => {
  const { storyId } = useParams<{ storyId: string }>();
  return <Navigate to={`/learn/${storyId}/${to}`} replace />;
};

function buildLearningRoutes(): React.ReactElement[] {
  const enabledSteps = resolveActiveSteps();

  // Build a lookup: stepId → next enabled stepId
  const nextEnabledStepId: Record<string, string | undefined> = {};
  for (let i = 0; i < enabledSteps.length - 1; i++) {
    nextEnabledStepId[enabledSteps[i].id] = enabledSteps[i + 1].id;
  }

  const routes: React.ReactElement[] = [];

  // #2752: iterate every REGISTERED step id, not just DEFAULT_STEP_SEQUENCE.
  //
  // A 文言文 lesson's classical-only steps (classical-text, classical-word-matching,
  // classical-sentence-matching, classical-self-challenge) are deliberately kept OUT
  // of DEFAULT_STEP_SEQUENCE — putting them there would add four empty-state pills
  // to the stepper nav of the ~165 白話 lessons that have none of this data (that nav
  // is driven by resolveActiveSteps(lesson.stepSequence), which falls back to
  // DEFAULT_STEP_SEQUENCE only for lessons without their own sequence).
  //
  // But this loop builds the actual <Route> elements, and a route that doesn't
  // exist here 404s/blanks regardless of what any lesson's step_sequence says.
  // STEP_REGISTRY is the true superset of "every step id that might ever be
  // navigated to" — DEFAULT_STEP_SEQUENCE was only ever a stand-in for that
  // because, before #2752, every registered id happened to also be a default
  // one. `nextEnabledStepId` above still keys off DEFAULT_STEP_SEQUENCE, so a
  // classical-only step's StepRoute gets nextPath=undefined (no "skip on
  // crash" fallback target) — that route-build-time value only feeds the
  // StepErrorBoundary skip button, not normal step-finish navigation (which
  // `dispatchStepFinish`'s lesson-aware override in useLearningStepNavigation.ts
  // resolves correctly per-lesson at click time).
  for (const stepId of Object.keys(STEP_REGISTRY)) {
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

  // Legacy step ids → their current path.
  //
  // #2641 renamed the ids; QR codes generated by the admin panel and links
  // written into issues still carry the old ones. Resolving them in
  // stepConfig was not enough — the router never consulted that map, so
  // /learn/2/full-reading fell through to the catch-all and dumped the
  // student back on their home page. Verified in a browser, which is the
  // only place this shows up: the unit test for resolveStepId() passed the
  // whole time.
  for (const [legacyId, currentId] of Object.entries(LEGACY_STEP_ID_ALIASES)) {
    if (!STEP_REGISTRY[currentId] || !STEP_PAGE_MAP[currentId]) continue;
    routes.push(
      <Route
        key={`legacy-${legacyId}`}
        path={legacyId}
        element={<LegacyStepRedirect to={currentId} />}
      />,
    );
  }

  return routes;
}



// ---------------------------------------------------------------------------
// learningRoutes — the public export.
// Evaluated once at module load time; immutable thereafter.
// ---------------------------------------------------------------------------

export const learningRoutes: React.ReactElement[] = buildLearningRoutes();
