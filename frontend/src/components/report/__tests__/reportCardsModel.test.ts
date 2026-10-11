/**
 * #3399 — 報告頁卡片：從 DB 的 step_progress 讀出每一關的完成狀態與分數。
 */
import { describe, expect, it } from 'vitest';
import { resolveActiveSteps } from '../../../config/stepConfig';
import { buildStepReportCards, marksFromAnnotations, normalizeStepKey } from '../reportCardsModel';

const steps = resolveActiveSteps(null);
const byId = (cards: ReturnType<typeof buildStepReportCards>, id: string) => cards.find((c) => c.stepId === id)!;

describe('buildStepReportCards', () => {
  it('one card per active step, report excluded', () => {
    const cards = buildStepReportCards(steps, [], {}, []);
    expect(cards.map((c) => c.stepId)).not.toContain('report');
    expect(cards.length).toBe(steps.filter((s) => s.id !== 'report').length);
    expect(cards.every((c) => !c.completed)).toBe(true);
  });

  it('reads scores from step_data', () => {
    const cards = buildStepReportCards(
      steps,
      ['vocab-definition', 'vocab-application', 'comprehension', 'keypoints-table'],
      {
        'vocab-definition': { result: { matchedCount: 14, totalCount: 16 } },
        'vocab-application': {
          score: 6, total: 8,
          firstTryResults: [{ sentenceIdx: 0, firstTryCorrect: false, studentFirstAnswer: '高興', correctAnswer: '興奮' }],
        },
        comprehension: { mcqScore: 4, mcqTotal: 5 },
        'keypoints-table': { gradeResult: { score: 50, results: [{ correct: true }, { correct: false, correct_answer: '主角' }] } },
      },
      [],
    );
    expect(byId(cards, 'vocab-definition').summary).toBe('答對 14/16 題');
    expect(byId(cards, 'vocab-application').summary).toBe('答對 6/8 題');
    expect(byId(cards, 'comprehension').summary).toBe('答對 4/5 題');
    expect(byId(cards, 'keypoints-table').summary).toBe('答對 1/2 題');
    const answers = byId(cards, 'vocab-application').details.find((d) => d.kind === 'answers');
    expect(answers).toMatchObject({ rows: [{ correct: false, studentAnswer: '高興', correctAnswer: '興奮' }] });
  });

  it('keypoints network-failure sentinel is not a score', () => {
    const cards = buildStepReportCards(steps, ['keypoints-table'], { 'keypoints-table': { gradeResult: { score: -1, results: [] } } }, []);
    expect(byId(cards, 'keypoints-table').summary).toBeNull();
    expect(byId(cards, 'keypoints-table').completed).toBe(true);
  });

  it('maps legacy step ids (reading-annotation / reading-strategy)', () => {
    expect(normalizeStepKey('reading-annotation')).toBe('full-text-annotate');
    expect(normalizeStepKey('reading-strategy#abc')).toBe('spotlight#abc');
    const cards = buildStepReportCards(steps, ['reading-annotation', 'reading-strategy'], {}, []);
    expect(byId(cards, 'full-text-annotate').completed).toBe(true);
    expect(byId(cards, 'spotlight').completed).toBe(true);
  });

  it('lesson-intro counts as done once any later step has progress', () => {
    expect(byId(buildStepReportCards(steps, [], {}, []), 'lesson-intro').completed).toBe(false);
    expect(byId(buildStepReportCards(steps, ['vocab-review'], {}, []), 'lesson-intro').completed).toBe(true);
    // 進報告頁就會寫入 report —— 不能因此把簡介算成完成
    expect(
      byId(buildStepReportCards(steps, ['report'], { report: { viewed_at: 'x' } }, []), 'lesson-intro').completed,
    ).toBe(false);
  });

  it('full-text-annotate lists the marks and counts', () => {
    const marks = [
      { type: 'unknown' as const, text: '喝采', paragraphIndex: 0 },
      { type: 'important' as const, text: '球后', paragraphIndex: 0 },
      { type: 'important' as const, text: '尊敬', paragraphIndex: 3 },
    ];
    const card = byId(buildStepReportCards(steps, ['full-text-annotate'], {}, marks), 'full-text-annotate');
    expect(card.summary).toBe('做了 3 個記號');
    expect(card.details).toContainEqual({ kind: 'marks', marks });
    expect(card.details[0]).toMatchObject({ kind: 'stats', items: [{ value: '1 個' }, { value: '2 個' }] });
  });

  it('shows loading while marks are still on their way', () => {
    const card = byId(buildStepReportCards(steps, [], {}, null), 'full-text-annotate');
    expect(card.details).toEqual([{ kind: 'note', text: '記號載入中…' }]);
  });
});

describe('lessons whose step ids carry a #slug', () => {
  const slugged = resolveActiveSteps(['lesson-intro', 'full-text-annotate#dcavv', 'spotlight#ab12c', 'report']);

  it('reads the suffixed key', () => {
    const cards = buildStepReportCards(slugged, ['full-text-annotate#dcavv'], {}, []);
    expect(byId(cards, 'full-text-annotate#dcavv').completed).toBe(true);
  });

  it('also accepts the plain / legacy id when the step appears once (old sessions, OMO sync)', () => {
    const cards = buildStepReportCards(
      slugged,
      ['reading-strategy'],
      { 'reading-strategy': { feedback: { a: true, b: false } } },
      [],
    );
    const spot = byId(cards, 'spotlight#ab12c');
    expect(spot.completed).toBe(true);
    expect(spot.summary).toBe('答對 1/2 題');
  });

  it('does NOT borrow the plain id when the step appears in several rounds', () => {
    const multi = resolveActiveSteps(['full-text-annotate#p1', 'full-text-annotate#p2']);
    const cards = buildStepReportCards(multi, ['full-text-annotate'], {}, []);
    expect(cards.every((c) => !c.completed)).toBe(true);
  });
});

describe('marksFromAnnotations', () => {
  it('slices the PUA-stripped paragraph and sorts by position', () => {
    const paras = ['戴資穎是球后', '贏得人心'];
    const marks = marksFromAnnotations(
      [
        { id: 2, paragraph_index: 1, char_start: 2, char_end: 4, annotation_type: 'important' },
        { id: 1, paragraph_index: 0, char_start: 0, char_end: 3, annotation_type: 'unknown' },
      ],
      paras,
    );
    expect(marks).toEqual([
      { type: 'unknown', text: '戴資穎', paragraphIndex: 0 },
      { type: 'important', text: '人心', paragraphIndex: 1 },
    ]);
  });
});
