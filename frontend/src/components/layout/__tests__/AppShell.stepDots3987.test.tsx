/**
 * Regression locks for #3987 UI-2 and UI-5 (PR #3988).
 *
 * UI-2: the step-row edge-fade mask (#3549) was only 24px wide — invisible
 * against the translucent header at actual phone size. Widened to 40px.
 * (See `stepEdgeFadeMask`'s docstring in AppShell.tsx for why this is
 * tested as a pure-function string assertion rather than a rendered-DOM
 * style assertion: jsdom's CSS parser silently drops any mask-image value
 * containing `calc()`, so the real rendered `style` attribute can never
 * show this literal in a test.)
 *
 * UI-5: the step-dot invisible tap area (`before:-inset-*`) only grew the
 * 28px dot to 36×36 — short of the ≥40×40 a11y-recommended minimum.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StepDots, stepEdgeFadeMask } from '../AppShell';
import type { StepConfig } from '../../../config/stepConfig';

function makeStep(id: string, displayChar: string): StepConfig {
  return {
    id,
    label: id,
    displayChar,
    hint: '',
    view: 'LESSON_INTRO',
    dbStepNumber: 1,
    needsStory: false,
    enabled: true,
    category: 'intro',
  } as unknown as StepConfig;
}

const STEPS = [makeStep('a', '1'), makeStep('b', '2'), makeStep('c', '3')];

function renderDots() {
  return render(
    <StepDots
      steps={STEPS}
      currentStepIndex={0}
      completedSet={new Set()}
      onStepClick={() => {}}
      prevStep={null}
      nextStep={STEPS[1]}
      navDisabled={false}
    />,
  );
}

describe('stepEdgeFadeMask (#3987 UI-2 — fade width 24px -> 40px)', () => {
  it('returns undefined when neither edge is faded (unchanged baseline)', () => {
    expect(stepEdgeFadeMask({ left: false, right: false })).toBeUndefined();
  });

  it('builds the mask at 40px, not the old 24px', () => {
    const mask = stepEdgeFadeMask({ left: false, right: true });
    expect(mask).toContain('40px');
    expect(mask).not.toContain('24px');
  });

  it('fades both edges with transparent stops on each faded side', () => {
    const mask = stepEdgeFadeMask({ left: true, right: true });
    expect(mask).toMatch(/^linear-gradient\(to right, transparent 0,/);
    expect(mask).toMatch(/transparent 100%\)$/);
  });
});

describe('StepDots tap target (#3987 UI-5 — before:-inset-1 -> before:-inset-1.5)', () => {
  it('every dot button carries the 40x40 invisible hit area class', () => {
    const { container } = renderDots();
    const dotButtons = Array.from(container.querySelectorAll('button')).filter(
      (btn) => btn.getAttribute('aria-label')?.match(/^\d+\. /),
    );
    expect(dotButtons.length).toBe(STEPS.length);
    for (const btn of dotButtons) {
      const classes = btn.className.split(/\s+/);
      expect(classes).toContain("before:-inset-1.5");
      expect(classes).not.toContain('before:-inset-1');
    }
  });
});
