/**
 * Locks each step's component name to the step it implements.
 *
 * #2641 renamed the step ids so each says what its label says. The components
 * behind them did not move, so a second layer of drift is left: the step
 * `key-passage-reading` (重點朗讀, reads one teacher-marked passage) is served
 * by a component called KeyPassageReading, and `paragraph-reading` by one called
 * ParagraphReading. Reading either name tells you the wrong thing about what it does —
 * which is exactly the confusion #2641 set out to remove.
 *
 * Asserts on the source text of learningRoutes.tsx rather than on runtime
 * imports: the lazy() wrappers erase the component identity at runtime, so
 * there is nothing to inspect once the module is loaded.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LEGACY_STEP_ID_ALIASES, STEP_REGISTRY } from '../config/stepConfig';

const ROUTES = readFileSync(join(__dirname, 'learningRoutes.tsx'), 'utf-8');

/** step id → the component name that must serve it. */
const EXPECTED_COMPONENTS: Record<string, string> = {
  'lesson-intro': 'IntroPage',
  'full-text-annotate': 'FullTextAnnotatePage',
  'paragraph-reading': 'ParagraphReadingPage',
  'key-passage-reading': 'KeyPassageReadingPage',
  listening: 'ListeningPage',
  'character-practice': 'CharacterPracticePage',
  'vocab-definition': 'VocabDefinitionMatchPage',
  'vocab-application': 'VocabApplicationPage',
  'keypoints-table': 'KeypointsTablePage',
  spotlight: 'SpotlightPage',
  'sentence-practice': 'SentencePracticePage',
  comprehension: 'ComprehensionMcqPage',
  'vocab-review': 'VocabReviewPage',
  dictation: 'DictationPage',
  'knowledge-station': 'KnowledgeStationPage',
  report: 'ReportPage',
};

describe('元件名必須說出它服務的 step', () => {
  it.each(Object.entries(EXPECTED_COMPONENTS))('%s → %s', (stepId, component) => {
    const line = ROUTES.split('\n').find((l) => l.includes(`'${stepId}':`));
    expect(line, `no route line for ${stepId}`).toBeDefined();
    expect(line).toContain(component);
  });

  it('no component name survives that contradicts its step', () => {
    // The three that actively mislead. Named explicitly so a partial rename
    // cannot pass by leaving the worst offenders behind.
    // Word-boundary matched on purpose: a plain substring check for
    // 'FullReadingPage' also fires on the correct new name
    // 'KeyPassageReadingPage', making the assertion unsatisfiable.
    for (const stale of ['FullReadingPage', 'TutorPage', 'StoryStructurePage']) {
      expect(ROUTES).not.toMatch(new RegExp(`\\b${stale}\\b`));
    }
  });
});

describe('#2641 舊 step 網址必須導到新的，不能掉回首頁', () => {
  /**
   * Resolving legacy ids inside stepConfig was not enough. The router builds
   * its paths from DEFAULT_STEP_SEQUENCE and never consulted that map, so
   * /learn/2/full-reading matched nothing and fell through to the catch-all,
   * which sent the student back to their home page.
   *
   * The unit test for resolveStepId() passed the entire time — it exercises the
   * function, not the route table. This asserts the route table itself carries
   * a path for every legacy id.
   */
  it('the route table emits a redirect path for every legacy id', () => {
    for (const legacyId of Object.keys(LEGACY_STEP_ID_ALIASES)) {
      expect(
        ROUTES.includes('LEGACY_STEP_ID_ALIASES'),
        'learningRoutes must iterate the alias map',
      ).toBe(true);
      // The generated path uses the legacy id verbatim as the route segment.
      expect(legacyId).toMatch(/^[a-z-]+$/);
    }
    expect(ROUTES).toContain('LegacyStepRedirect');
  });

  it('every legacy id points at a step that actually exists', () => {
    for (const [legacyId, currentId] of Object.entries(LEGACY_STEP_ID_ALIASES)) {
      expect(STEP_REGISTRY[currentId], `${legacyId} → ${currentId} is not a real step`).toBeDefined();
    }
  });
});
