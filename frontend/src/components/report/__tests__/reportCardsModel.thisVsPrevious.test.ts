/**
 * #4028 — 報告卡片要分得出「這次完成」跟「上次完成（#2889 帶過來的）」。
 *
 * 回到做過的課時，後端把上次的 steps_completed 整份帶進新 session，於是一進
 * 報告頁就全部打勾（staging：25 秒的 session 有 16 關「已完成」）。
 */
import { describe, expect, it } from 'vitest';
import { resolveActiveSteps } from '../../../config/stepConfig';
import {
  buildStepReportCards,
  progressOrigin,
  stepsDoneThisSession,
  type ProgressOrigin,
} from '../reportCardsModel';

const steps = resolveActiveSteps(null);
type Cards = ReturnType<typeof buildStepReportCards>;
const byId = (cards: Cards, id: string) => cards.find((c) => c.stepId === id)!;
const statuses = (cards: Cards) => Object.fromEntries(cards.map((c) => [c.stepId, c.status]));

const LAST_TIME = ['full-text-annotate', 'key-passage-reading', 'vocab-definition', 'comprehension'];
const carriedOnly: ProgressOrigin = {
  carriedStepsCompleted: LAST_TIME,
  carriedAt: '2026-11-10T03:00:00Z',
  carriedSessionId: 7174,
  sessionStepsCompleted: [],
};

describe('buildStepReportCards — this time vs last time (#4028)', () => {
  it('a reopened lesson with nothing done yet ticks nothing as done this time', () => {
    const cards = buildStepReportCards(steps, LAST_TIME, {}, [], { origin: carriedOnly });
    expect(cards.filter((c) => c.status === 'this')).toEqual([]);
    for (const id of LAST_TIME) {
      expect(byId(cards, id).status).toBe('previous');
      expect(byId(cards, id).completed).toBe(false);
      expect(byId(cards, id).previousAt).toBe('2026-11-10T03:00:00Z');
    }
    // 簡介也是上次的，不是這次的
    expect(byId(cards, 'lesson-intro').status).toBe('previous');
    expect(byId(cards, 'spotlight').status).toBe('none');
  });

  it('a step done for the first time in this session is this time', () => {
    const cards = buildStepReportCards(steps, [...LAST_TIME, 'spotlight'], {}, [], { origin: carriedOnly });
    expect(byId(cards, 'spotlight').status).toBe('this');
    expect(byId(cards, 'spotlight').completed).toBe(true);
    expect(byId(cards, 'lesson-intro').status).toBe('this');
    expect(byId(cards, 'comprehension').status).toBe('previous');
  });

  it('a step redone in this session is this time, even though it was carried', () => {
    const cards = buildStepReportCards(steps, LAST_TIME, {}, [], { origin: {
      ...carriedOnly,
      sessionStepsCompleted: ['comprehension'],
    } });
    expect(byId(cards, 'comprehension').status).toBe('this');
    expect(byId(cards, 'vocab-definition').status).toBe('previous');
  });

  it('carried step_data with completed:true is last time, not this time', () => {
    const cards = buildStepReportCards(steps, [], { spotlight: { completed: true } }, [], { origin: carriedOnly });
    expect(byId(cards, 'spotlight').status).toBe('previous');
  });

  it('a session with no carry record behaves exactly as before #4028', () => {
    const cards = buildStepReportCards(steps, LAST_TIME, { spotlight: { completed: true } }, []);
    for (const id of [...LAST_TIME, 'spotlight', 'lesson-intro']) expect(byId(cards, id).status).toBe('this');
    expect(statuses(cards)['keypoints-table']).toBe('none');
    expect(cards.every((c) => c.previousAt === null)).toBe(true);
  });

  it('legacy step ids in the carried list still match (reading-annotation → full-text-annotate)', () => {
    const cards = buildStepReportCards(steps, ['reading-annotation'], {}, [], { origin: {
      carriedStepsCompleted: ['reading-annotation'],
      sessionStepsCompleted: [],
    } });
    expect(byId(cards, 'full-text-annotate').status).toBe('previous');
  });
});

describe('progressOrigin', () => {
  it('reads the carry record and this-session list from raw step_progress', () => {
    expect(
      progressOrigin({
        steps_completed: ['x'],
        session_steps_completed: ['x'],
        __meta: { carried_from: { session_id: 7, at: '2026-11-10T03:00:00Z', steps_completed: ['y'] } },
      }),
    ).toEqual({
      sessionStepsCompleted: ['x'],
      carriedStepsCompleted: ['y'],
      carriedAt: '2026-11-10T03:00:00Z',
      carriedSessionId: 7,
    });
  });

  it('treats a missing or malformed record as no carry', () => {
    expect(progressOrigin(null)).toEqual({});
    expect(progressOrigin({ steps_completed: [] })).toMatchObject({ carriedStepsCompleted: null, carriedSessionId: null });
    expect(progressOrigin({ __meta: { carried_from: 'oops' } })).toMatchObject({ carriedStepsCompleted: null });
  });
});

describe('stepsDoneThisSession', () => {
  it('is empty for a reopened lesson where only the report was opened', () => {
    expect(
      stepsDoneThisSession({
        steps_completed: [...LAST_TIME, 'report'],
        session_steps_completed: ['report'],
        __meta: { carried_from: { session_id: 1, steps_completed: LAST_TIME } },
      }),
    ).toEqual([]);
  });

  it('counts new steps and redone steps', () => {
    expect(
      stepsDoneThisSession({
        steps_completed: [...LAST_TIME, 'spotlight'],
        session_steps_completed: ['comprehension'],
        __meta: { carried_from: { session_id: 1, steps_completed: LAST_TIME } },
      }).sort(),
    ).toEqual(['comprehension', 'spotlight']);
  });

  it('counts everything for a session that was never carried', () => {
    expect(stepsDoneThisSession({ steps_completed: ['spotlight', 'report'] })).toEqual(['spotlight']);
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

  it('old sessions with only result still show something, labelled as after correction', () => {
    const c = byId(buildStepReportCards(steps, [], { 'vocab-definition': { result: { matchedCount: 7, totalCount: 8 } } }, []), 'vocab-definition');
    expect(c.details[0]).toMatchObject({ items: [{ label: '答對（含訂正）', value: '7 / 8 題' }] });
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
