/**
 * #4028 — 報告卡片：完成就是綠色；還有題目錯著沒改對 → 黃色（要訂正）。訂正完就變回綠色，
 * 卡片註明訂正過幾題（#4087 案主定調）。
 * 詞語理解改用「第一次作答」計分，列出答錯與訂正。上方導覽列用 stepIdsNeedingReview。
 */
import { describe, expect, it } from 'vitest';
import { resolveActiveSteps } from '../../../config/stepConfig';
import { buildStepReportCards, radarOf, stepIdsNeedingReview, strengthsOf } from '../reportCardsModel';

const steps = resolveActiveSteps(null);
type Cards = ReturnType<typeof buildStepReportCards>;
const byId = (cards: Cards, id: string) => cards.find((c) => c.stepId === id)!;

describe('card status: green / yellow / not done', () => {
  const data = {
    comprehension: {
      mcqScore: 3, mcqTotal: 4,
      firstTry: [
        { id: 'q1', firstTryCorrect: true }, { id: 'q2', firstTryCorrect: false },
        { id: 'q3', firstTryCorrect: true }, { id: 'q4', firstTryCorrect: true },
      ],
      feedback: { q1: true, q2: false, q3: true, q4: true }, // q2 還錯著
    },
    'vocab-application': { score: 8, total: 8 },
    spotlight: { feedback: { a: true, b: true } },
  };
  const cards = buildStepReportCards(steps, ['comprehension', 'vocab-application', 'spotlight', 'full-text-annotate'], data, []);

  it('a completed step with a question still wrong is yellow, and says how many', () => {
    expect(byId(cards, 'comprehension').status).toBe('review');
    expect(byId(cards, 'comprehension').toFix).toBe(1);
    expect(byId(cards, 'comprehension').completed).toBe(true);
  });

  it('once every miss is corrected it turns green and remembers how many were fixed', () => {
    const fixed = { ...data, comprehension: { ...data.comprehension, feedback: { q1: true, q2: true, q3: true, q4: true } } };
    const c = byId(buildStepReportCards(steps, ['comprehension'], fixed, []), 'comprehension');
    expect(c.status).toBe('done');
    expect(c).toMatchObject({ toFix: 0, fixed: 1 });
    expect(c.summary).toBe('答對 3/4 題'); // 分數照第一次算
  });

  it('a completed step answered right first time is green', () => {
    expect(byId(cards, 'vocab-application').status).toBe('done');
    expect(byId(cards, 'spotlight').status).toBe('done');
  });

  it('a completed step with nothing to get wrong is green', () => {
    expect(byId(cards, 'full-text-annotate').status).toBe('done');
    expect(byId(cards, 'lesson-intro').status).toBe('done');
  });

  it('a step not done is neither', () => {
    expect(byId(cards, 'keypoints-table').status).toBe('none');
  });

  it('wrong answers on a step that is NOT completed do not make it yellow', () => {
    const c = buildStepReportCards(steps, [], data, []);
    expect(byId(c, 'comprehension').status).toBe('none');
  });

  it('score-only old records cannot tell what is still wrong, so they are not yellow', () => {
    const c = buildStepReportCards(steps, ['vocab-application'], { 'vocab-application': { score: 6, total: 8 } }, []);
    expect(byId(c, 'vocab-application').status).toBe('done');
  });

  it('vocab-application misses are always corrected by the end (you cannot move on without the right word)', () => {
    const c = byId(buildStepReportCards(steps, ['vocab-application'], { 'vocab-application': { score: 1, total: 2,
      firstTryResults: [{ firstTryCorrect: false }, { firstTryCorrect: true }] } }, []), 'vocab-application');
    expect(c).toMatchObject({ status: 'done', fixed: 1, toFix: 0 });
  });

  it('the top stepper gets exactly the yellow steps', () => {
    expect([...stepIdsNeedingReview(steps, ['comprehension', 'vocab-application'], data)]).toEqual(['comprehension']);
  });

  it('a carried-forward step done last time is simply green (no "last time" state)', () => {
    const c = buildStepReportCards(steps, ['vocab-application'], { 'vocab-application': { score: 8, total: 8 } }, []);
    expect(byId(c, 'vocab-application').status).toBe('done');
  });
});

// ── #4028：詞語理解要列出答錯與訂正，不能只給「訂正完」的答對數 ─────────────────
describe('vocab-definition details', () => {
  const vocab = [
    { word: '優雅', definition: '優美高雅。' },
    { word: '偶有所見', definition: '並不常見，但偶爾會出現。' },
    { word: '區間車', definition: '每站都停的火車。' },
  ];
  const data = {
    result: { matchedCount: 3, totalCount: 3 }, // 訂正完的數字 —— 不能拿來當成績
    mcAnswers: [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: false, firstTryAnsweredWordIdx: 2 },
      { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: true },
    ],
    dragDropAnswers: [
      { defIndex: 2, answeredWordIdx: 0, correct: false, firstTryCorrect: false, firstTryAnsweredWordIdx: 0 },
    ],
  };
  const card = () =>
    byId(buildStepReportCards(steps, ['vocab-definition'], { 'vocab-definition': data }, [], {
      vocabularyFor: (id) => (id === 'vocab-definition' ? vocab : undefined),
    }), 'vocab-definition');

  it('scores by the first try, not the corrected result', () => {
    expect(card().summary).toBe('答對 1/3 題');
    expect(card().details[0]).toEqual({
      kind: 'stats',
      items: [
        { label: '第一次就答對', value: '1 / 3 題' },
        { label: '答錯後訂正', value: '1 / 2 題' },
      ],
    });
  });

  it('lists each wrong answer with what was picked, the right word, and whether it was corrected', () => {
    const mc = card().details.find((d) => d.kind === 'answers' && d.title === '選擇題');
    expect(mc).toMatchObject({
      rows: [
        { correct: false, prompt: '優美高雅。', studentAnswer: '區間車', correctAnswer: '優雅', corrected: true },
        { correct: true, corrected: null },
      ],
    });
    const dd = card().details.find((d) => d.kind === 'answers' && d.title === '拖拉配對');
    expect(dd).toMatchObject({ rows: [{ correct: false, studentAnswer: '優雅', correctAnswer: '區間車', corrected: false }] });
  });

  it('is yellow because a word was missed on the first try', () => {
    expect(card().status).toBe('review');
  });

  it('old sessions with only result still show something, labelled as after correction, and are not guessed yellow', () => {
    const c = byId(buildStepReportCards(steps, ['vocab-definition'], { 'vocab-definition': { result: { matchedCount: 7, totalCount: 8 } } }, []), 'vocab-definition');
    expect(c.details[0]).toMatchObject({ items: [{ label: '答對（含訂正）', value: '7 / 8 題' }] });
    expect(c.status).toBe('done');
  });
});

describe('comprehension details', () => {
  it('marks a first-try miss as corrected when the latest answer is right', () => {
    const c = byId(buildStepReportCards(steps, ['comprehension'], {
      comprehension: {
        mcqScore: 1, mcqTotal: 2,
        feedback: { q1: true, q2: false },
        firstTry: [
          { id: 'q1', firstTryCorrect: false, studentFirstAnswer: 'A', correctAnswer: 'B' },
          { id: 'q2', firstTryCorrect: false, studentFirstAnswer: 'C', correctAnswer: 'D' },
        ],
      },
    }, []), 'comprehension');
    expect(c.details.find((d) => d.kind === 'answers')).toMatchObject({
      rows: [{ corrected: true }, { corrected: false }],
    });
  });
});

describe('spotlight uses first-try verdicts (#4081)', () => {
  const log = {
    a: { order: 0, label: 'A 題', firstAnswer: '錯', latestAnswer: '對', correctAnswer: '對' },
    b: { order: 1, label: 'B 題', firstAnswer: 'B', latestAnswer: 'B', correctAnswer: 'B' },
  };

  it('a question still wrong keeps spotlight yellow', () => {
    const c = buildStepReportCards(steps, ['spotlight'], {
      spotlight: { feedback: { a: false, b: true }, firstFeedback: { a: false, b: true }, answerLog: log },
    }, []);
    expect(byId(c, 'spotlight')).toMatchObject({ status: 'review', toFix: 1 });
  });

  it('a question missed first time but corrected is green, scored by the first try', () => {
    const c = buildStepReportCards(steps, ['spotlight'], {
      spotlight: { feedback: { a: true, b: true }, firstFeedback: { a: false, b: true }, answerLog: log },
    }, []);
    expect(byId(c, 'spotlight')).toMatchObject({ status: 'done', fixed: 1, toFix: 0 });
    expect(byId(c, 'spotlight').summary).toBe('答對 1/2 題');
  });

  it('old sessions with only the latest feedback are not guessed yellow', () => {
    const c = buildStepReportCards(steps, ['spotlight'], { spotlight: { feedback: { a: true, b: false } } }, []);
    expect(byId(c, 'spotlight').status).toBe('done');
  });
});

describe('attempts, rate and radar (#4087)', () => {
  const att = (id: string, at: string, correct: number, total: number) => ({ id, at, kind: 'first', correct, total });

  it('a step\'s attempts come back in time order and its rate is the latest attempt', () => {
    const c = byId(buildStepReportCards(steps, ['comprehension'], {
      comprehension: { mcqScore: 1, mcqTotal: 4, attempts: [att('b', '2026-11-16T02:00:00Z', 4, 4), att('a', '2026-11-16T01:00:00Z', 1, 4)] },
    }, []), 'comprehension');
    expect(c.attempts.map((a) => a.id)).toEqual(['a', 'b']);
    expect(c.chart).toBe('score');
    expect(c.rate).toBe(100);
  });

  it('without attempts the rate falls back to the current first-try score', () => {
    const c = byId(buildStepReportCards(steps, ['comprehension'], { comprehension: { mcqScore: 3, mcqTotal: 4 } }, []), 'comprehension');
    expect(c.rate).toBe(75);
  });

  it('steps with no right/wrong have no chart and no rate', () => {
    const c = byId(buildStepReportCards(steps, ['full-text-annotate'], { 'full-text-annotate': { attempts: [att('x', 'y', 1, 1)] } }, []), 'full-text-annotate');
    expect(c.chart).toBeNull();
    expect(c.attempts).toEqual([]);
    expect(c.rate).toBeNull();
  });

  it('the radar always has the same five axes; vocab averages its steps; missing ones are marked', () => {
    const cards = buildStepReportCards(steps, ['vocab-definition', 'vocab-application'], {
      'vocab-application': { score: 3, total: 4 },
      'vocab-definition': { attempts: [att('a', '2026-11-16T01:00:00Z', 1, 2)] },
    }, []);
    const r = radarOf(cards);
    expect(r.map((p) => p.label)).toEqual(['詞語力', '文意理解', '結構統整', '閱讀策略', '朗讀流暢']);
    expect(r[0]).toMatchObject({ state: 'scored', value: Math.round((50 + 75) / 2) });
    expect(r[1].state).toBe('todo'); // comprehension exists in the default steps but has no score
    expect(radarOf(cards.filter((c) => c.baseId !== 'spotlight'))[3].state).toBe('absent');
  });

  it('strengths need two scored axes with different values', () => {
    expect(strengthsOf([{ key: 'a', label: 'A', value: 80, state: 'scored' }])).toEqual({ strong: [], weak: [] });
    expect(strengthsOf([
      { key: 'a', label: 'A', value: 80, state: 'scored' },
      { key: 'b', label: 'B', value: 40, state: 'scored' },
      { key: 'c', label: 'C', value: null, state: 'absent' },
    ])).toEqual({ strong: ['A'], weak: ['B'] });
  });

  it('a step done but without a score (old record) is 無紀錄, not 還沒做', () => {
    const cards = buildStepReportCards(steps, ['vocab-definition'], { 'vocab-definition': { result: { matchedCount: 7, totalCount: 8 } } }, []);
    expect(radarOf(cards)[0].state).toBe('unscored');
  });

  it('spotlight lists each question from its answer log: first pick, right answer, corrected (#4087)', () => {
    const c = byId(buildStepReportCards(steps, ['spotlight'], {
      spotlight: {
        feedback: { k1: true, k2: true },
        firstFeedback: { k1: false, k2: true },
        answerLog: {
          k2: { order: 1, label: '第二題題目', firstAnswer: 'B', latestAnswer: 'B', correctAnswer: 'B' },
          k1: { order: 0, label: '第一題題目', firstAnswer: '錯的', latestAnswer: '對的', correctAnswer: '對的' },
        },
      },
    }, []), 'spotlight');
    expect(c.details.find((d) => d.kind === 'answers')).toMatchObject({
      rows: [
        { prompt: '第一題題目', correct: false, studentAnswer: '錯的', correctAnswer: '對的', corrected: true },
        { prompt: '第二題題目', correct: true, corrected: null },
      ],
    });
  });

  it('the radar rate ignores 訂正錯題 attempts (their after-correction score is not ability) (#4087)', () => {
    const c = byId(buildStepReportCards(steps, ['comprehension'], {
      comprehension: { attempts: [
        { id: 'a', at: '2026-11-16T01:00:00Z', kind: 'first', correct: 2, total: 4 },
        { id: 'b', at: '2026-11-16T02:00:00Z', kind: 'retry-wrong', correct: 4, total: 4 },
      ] },
    }, []), 'comprehension');
    expect(c.rate).toBe(50);
  });
});
