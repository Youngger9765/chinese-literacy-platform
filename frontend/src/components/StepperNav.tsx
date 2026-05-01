import React, { useRef, useEffect } from 'react';
import { AppView, Story, LearningSession } from '../types';
import { ACTIVE_STEPS, STEP_CATEGORY_COLORS } from '../config/stepConfig';

interface StepperNavProps {
  currentView: AppView;
  session: LearningSession | null;
  selectedStory: Story | null;
  onNavigate: (view: AppView) => void;
}

type StepStatus = 'disabled' | 'idle' | 'active' | 'completed';

interface StepDef {
  step: number;
  label: string;
  view: AppView;
  needsStory: boolean;
  category: 'reading' | 'comprehension' | 'practice' | 'report';
}

/**
 * Steps are derived from the central ACTIVE_STEPS config so that reordering
 * or adding steps only requires editing stepConfig.ts.
 */
const steps: StepDef[] = ACTIVE_STEPS.map((s, i) => ({
  step: i + 1,
  label: s.label,
  view: s.view,
  needsStory: s.needsStory,
  category: s.category,
}));

const VIEW_TO_STEP_ID: Record<string, string> = Object.fromEntries(
  ACTIVE_STEPS.map((s) => [s.view, s.id]),
);

function getStepStatus(
  stepDef: StepDef,
  currentView: AppView,
  session: LearningSession | null,
  selectedStory: Story | null,
): StepStatus {
  if (currentView === stepDef.view) return 'active';
  if (stepDef.needsStory && !selectedStory) return 'disabled';

  // Check completion based on session data
  const isCompleted = (() => {
    if (!session) return false;
    const completedSet = new Set(session.completedSteps ?? []);
    const stepId = VIEW_TO_STEP_ID[stepDef.view];
    if (stepId && completedSet.has(stepId)) return true;
    switch (stepDef.view) {
      case AppView.INTRO:                    return session.introCompleted;
      case AppView.TUTOR:                    return session.readingAttempt !== null;
      case AppView.VOCAB:                    return session.vocabResult !== null;
      case AppView.DICTATION:               return session.dictationResult !== null;
      case AppView.COMPREHENSION:           return session.comprehensionResult !== null;
      case AppView.FULL_READING:            return session.fullReadingResult !== null;
      case AppView.READING_ANNOTATION:      return session.readingAnnotationCompleted === true;
      case AppView.VOCAB_DEFINITION_MATCH:  return session.vocabDefinitionMatchCompleted === true;
      case AppView.VOCAB_APPLICATION:       return session.vocabApplicationCompleted === true;
      case AppView.VOCAB_WORD_SEARCH:       return session.vocabWordSearchCompleted === true;
      case AppView.KNOWLEDGE_STATION:       return session.knowledgeStationCompleted === true;
      case AppView.REPORT:                  return false; // destination step, never "completed"
      default:                              return false;
    }
  })();

  return isCompleted ? 'completed' : 'idle';
}

// -- Step badge sub-component --
const StepBadge: React.FC<{
  step: number;
  status: StepStatus;
  category?: 'reading' | 'comprehension' | 'practice' | 'report';
}> = ({ step, status, category }) => {
  const categoryColors = category ? STEP_CATEGORY_COLORS[category] : null;

  const styleMap: Record<StepStatus, string> = {
    disabled:  'bg-gray-200 text-gray-400',
    idle:      categoryColors ? `${categoryColors.badge}/20 ${categoryColors.text}` : 'bg-gray-200 text-gray-700',
    active:    categoryColors ? `${categoryColors.badge} text-white` : 'bg-accent text-white',
    completed: 'bg-emerald-500 text-white',
  };

  return (
    <span
      className={`w-12 h-12 text-sm rounded-full flex items-center justify-center font-bold shrink-0 ${styleMap[status]}`}
    >
      {status === 'completed' ? (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        step
      )}
    </span>
  );
};

// ── Horizontal top nav (shared for desktop & mobile) ─────────────────────

/**
 * StepperNav — horizontal top navigation bar.
 *
 * Desktop (md+): horizontal row of step pills with labels.
 * Mobile (<md): horizontally scrollable compact step indicators.
 *
 * Auto-scrolls the active step into view on mount and when the step changes.
 */
const StepperNav: React.FC<StepperNavProps> = ({
  currentView,
  session,
  selectedStory,
  onNavigate,
}) => {
  const scrollRef = useRef<HTMLElement>(null);

  // Auto-scroll the active step into view
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeEl = container.querySelector('[aria-current="step"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentView]);

  return (
    <nav
      ref={scrollRef}
      aria-label="學習步驟導覽"
      className="font-ui bg-white border-b border-gray-200 shrink-0 overflow-x-auto scrollbar-hide"
    >
      <div className="flex items-center gap-2 px-3 py-3 min-w-max">
        {/* Story title pill — desktop only */}
        {selectedStory && (
          <div className="hidden md:flex items-center mr-2 pr-3 border-r border-gray-200">
            <p className="text-xs font-semibold text-gray-500 truncate max-w-[120px]" title={selectedStory.title}>
              {selectedStory.title}
            </p>
          </div>
        )}

        {/* Step pills */}
        {steps.map((stepDef) => {
          const status = getStepStatus(stepDef, currentView, session, selectedStory);
          const isActive = status === 'active';
          const isDisabled = status === 'disabled';
          const categoryColors = STEP_CATEGORY_COLORS[stepDef.category];

          return (
            <button
              key={stepDef.view}
              onClick={() => !isDisabled && onNavigate(stepDef.view)}
              disabled={isDisabled}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`步驟 ${stepDef.step}：${stepDef.label}（${isActive ? '目前' : isDisabled ? '未解鎖' : status === 'completed' ? '已完成' : '未完成'}）`}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                isActive
                  ? `${categoryColors.activeBg} ${categoryColors.text}`
                  : isDisabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <StepBadge step={stepDef.step} status={status} category={stepDef.category} />
              {/* Show label on desktop, hide on mobile to save space */}
              <span className={`hidden md:inline text-xs leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {stepDef.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default StepperNav;
