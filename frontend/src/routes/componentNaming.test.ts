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
