/**
 * fetchStory.lessonContent.test.ts — api.ts consumption of the backend lesson_content.
 *
 * Proves the DARK wiring's frontend half end-to-end through the PUBLIC surface
 * (fetchStory → apiDetailToStory): a REAL backend-produced snake_case lesson_content
 * payload is camelized + LessonSchema.safeParse'd into `story.lessonContent`, and any
 * drift / null / half-shape resolves to `undefined` (fail-safe fallback to storyToLesson),
 * never a throw. The fixtures are the actual bytes lesson_content_loader emits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchStory } from '../api';
import greenLesson from '../../schema/__tests__/fixtures/backend_lesson_green.json';

// Minimal valid ApiStoryDetail base (only the fields apiDetailToStory reads). lesson_content
// is spliced in per-case. grade_code etc. are arbitrary but well-formed.
function baseDetail(lessonNumber: number): Record<string, unknown> {
  return {
    lesson_number: lessonNumber,
    title: 'T',
    grade: 4,
    grade_code: 'G4-L04',
    genre: '記敘文',
    category: 'Science',
    char_count: 100,
    thumbnail_url: '',
    reading_strategy: null,
    intro: { author: 'a', background: 'b' },
    paragraphs: ['p1'],
    vocabulary: null,
    fill_in_blank: null,
    multiple_choice: null,
    vocab_bank: null,
    knowledge_video_url: null,
    video_links: null,
    reading_benchmark: null,
    text_type: '單',
    source_file: 'x.yml',
    strategy_exercise: null,
    spotlight_v2: null,
    step_sequence: null,
  };
}

function mockFetchOnce(payload: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe('fetchStory → story.lessonContent (backend lesson_content wiring)', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    // Keep DEV-branch console.warn quiet + observable.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('valid backend lesson_content → parsed into story.lessonContent', async () => {
    const detail = { ...baseDetail(9101), lesson_content: greenLesson };
    global.fetch = mockFetchOnce(detail) as unknown as typeof fetch;

    const story = await fetchStory('9101');
    expect(story.lessonContent).toBeDefined();
    // camelized + typed: lessonCode present (was lesson_code), blocks preserved.
    expect(story.lessonContent!.lessonCode).toBe((greenLesson as { lesson_code: string }).lesson_code);
    expect(story.lessonContent!.blocks.length).toBe(greenLesson.blocks.length);
    // enum string values survive verbatim (answerSpace/grader stay snake-valued).
    const ex = story.lessonContent!.blocks.find((b) => b.type === 'exercise');
    expect(ex).toBeDefined();
  });

  it('null lesson_content (backend flag OFF) → lessonContent undefined, no throw', async () => {
    const detail = { ...baseDetail(9102), lesson_content: null };
    global.fetch = mockFetchOnce(detail) as unknown as typeof fetch;

    const story = await fetchStory('9102');
    expect(story.lessonContent).toBeUndefined();
  });

  it('missing lesson_content key entirely → lessonContent undefined', async () => {
    const detail = baseDetail(9103); // no lesson_content field
    global.fetch = mockFetchOnce(detail) as unknown as typeof fetch;

    const story = await fetchStory('9103');
    expect(story.lessonContent).toBeUndefined();
  });

  it('drifted / half-shape lesson_content → safeParse fails → undefined (fallback), no throw', async () => {
    // A shape that will NOT satisfy LessonSchema (blocks missing, unknown fields).
    const bad = { id: 'x', lesson_code: 'G4-L4', bogus_field: 1 };
    const detail = { ...baseDetail(9104), lesson_content: bad };
    global.fetch = mockFetchOnce(detail) as unknown as typeof fetch;

    const story = await fetchStory('9104');
    expect(story.lessonContent).toBeUndefined();
    // DEV warn path is allowed to fire; must never throw.
  });

  it('exercise-only block with invalid answer invariant → rejected (no fake-valid Lesson)', async () => {
    // An exercise with no answer AND needs_review:false must fail the contract invariant,
    // so a broken payload can never slip in as a "valid" lessonContent.
    const bad = {
      id: 'x',
      lesson_code: 'G4-L4',
      title: null,
      blocks: [
        {
          id: 'ex1',
          type: 'exercise',
          question: { kind: 'guided_steps', strategy_name: 's', instruction: 'i', steps: [] },
          answer_space: 'free_text',
          answer: null,
          grader: 'rubric_ai',
          anchors: [],
          needs_review: false,
        },
      ],
    };
    const detail = { ...baseDetail(9105), lesson_content: bad };
    global.fetch = mockFetchOnce(detail) as unknown as typeof fetch;

    const story = await fetchStory('9105');
    expect(story.lessonContent).toBeUndefined();
  });
});
