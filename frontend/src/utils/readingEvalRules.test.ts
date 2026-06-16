/**
 * Reading evaluation rule tests (Live Tutor + local eval pipeline).
 *
 * Maps product rules to automated checks (no microphone / STT API required).
 * See section headers for rule IDs R1–R6 and appendix rules from prior commits.
 */
import { describe, expect, it } from 'vitest';
import type { DiffToken } from '../types';
import { analyzeFluency } from './fluencyAnalyzer';
import { localEvaluateParagraph, getReadingPassThreshold } from './localEval';
import { buildTranscriptForEvaluation } from './liveTutorTranscriptPipeline';
import {
  cleanSpokenForDiff,
  countScorableCharacters,
  diffCharacters,
  interleavePunctuation,
  normalizeForComparison,
  normalizePunctuationToChinese,
} from './textDiff';
import { isHomophone, isSttEquivalent } from './pinyin';
import {
  DUPLICATE_RENCAI_TARGET,
  MENGCHANGJUN_LINE,
  POOLS_FIXTURE,
  QIN_LINE,
} from './readingEvalFixtures';

function displayChars(target: string, spoken: string): DiffToken[] {
  const { tokens } = diffCharacters(spoken, target, { useHomophone: true });
  return interleavePunctuation(target, tokens);
}

function greenScorableCount(display: DiffToken[]): number {
  return display.filter((t) => t.type === 'correct' || t.type === 'forgiven').length;
}

function evaluateGeminiPath(
  rawGemini: string,
  rawStt: string,
  targetText: string,
  durationMs: number,
) {
  const { cleaned, conservativeClampApplied } = buildTranscriptForEvaluation({
    source: 'gemini',
    rawTranscript: rawGemini,
    rawStt,
    targetText,
    durationMs,
  });
  const local = localEvaluateParagraph(cleaned, targetText, durationMs, POOLS_FIXTURE, 0);
  return { cleaned, conservativeClampApplied, ...local };
}

// ─── R1: 標點符號不計入比對／計分 ─────────────────────────────────────────

describe('R1 — punctuation excluded from scoring', () => {
  it('normalize strips punctuation from comparison length', () => {
    const withPunct = '媽媽說，你好。';
    const plain = '媽媽說你好';
    expect(countScorableCharacters(withPunct)).toBe(countScorableCharacters(plain));
    expect(normalizeForComparison(withPunct)).toBe(normalizeForComparison(plain));
  });

  it('matchRate ignores punctuation in target', () => {
    const target = '媽媽說，你好。';
    const spoken = '媽媽說你好';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
    expect(result.correctCount + result.missingCount + result.wrongCount).toBe(5);
  });

  it('interleave shows punctuation as punctuation type, not correct', () => {
    const target = '你好，世界！';
    const display = displayChars(target, '你好世界');
    expect(display.map((t) => `${t.char}:${t.type}`)).toEqual([
      '你:correct',
      '好:correct',
      '，:punctuation',
      '世:correct',
      '界:correct',
      '！:punctuation',
    ]);
  });

  it('STT ASCII punctuation still scores full match after normalization', () => {
    const target = '中國的戰國時期，有七個國家';
    const spoken = '中國的戰國時期, 有七個國家';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
  });
});

// ─── R2: 漏字、漏句可抓到 ─────────────────────────────────────────────────

describe('R2 — missing chars and partial sentences detected', () => {
  it('single skipped char in middle → missing', () => {
    const target = '其中最有名的人才是齊國的孟嘗君';
    const spoken = '其中有名的人才是齊國的孟嘗君';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.tokens.find((t) => t.char === '最' && t.type === 'missing')).toBeDefined();
    expect(result.missingCount).toBe(1);
    expect(result.matchRate).toBeLessThan(1);
  });

  it('unread sentence tail → missing on all unread scorable chars', () => {
    const target = '中國的戰國時期，有七個國家總是爭強鬥勝';
    const spoken = '中國的戰國時期';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.missingCount).toBeGreaterThan(5);
    const display = interleavePunctuation(target, result.tokens);
    expect(display.filter((t) => t.type === 'missing').length).toBeGreaterThan(0);
  });

  it('empty speech → 0% match, all scorable chars missing', () => {
    const target = '他們去公園玩耍';
    const result = diffCharacters('', target, { useHomophone: true });
    expect(result.matchRate).toBe(0);
    expect(result.missingCount).toBe(normalizeForComparison(target).length);
  });

  it('localEvaluateParagraph tier 3 when only opening read', () => {
    const spoken = '中國的戰國時期';
    const result = localEvaluateParagraph(spoken, MENGCHANGJUN_LINE, 12_000, POOLS_FIXTURE, 0);
    expect(result.matchRate).toBeLessThan(0.4);
    expect(result.tier).toBe(3);
  });
});

// ─── R3: 不過分綠色（遠端重複字不因前面唸過就亮） ─────────────────────────

describe('R3 — no ghost-green on distant duplicate characters', () => {
  it('only first 人才 pair matches when student read prefix only', () => {
    const spoken = '管理人才';
    const result = diffCharacters(spoken, DUPLICATE_RENCAI_TARGET, { useHomophone: true });
    const matchedRen = result.tokens.filter(
      (t) => t.char === '人' && (t.type === 'correct' || t.type === 'forgiven'),
    ).length;
    const matchedCai = result.tokens.filter(
      (t) => t.char === '才' && (t.type === 'correct' || t.type === 'forgiven'),
    ).length;
    expect(matchedRen).toBe(1);
    expect(matchedCai).toBe(1);
    expect(result.missingCount).toBeGreaterThan(0);
  });

  it('partial paragraph: green count ≈ spoken length, not full target', () => {
    const spoken = '中國的戰國時期，有七個國家';
    const display = displayChars(MENGCHANGJUN_LINE, spoken);
    const green = greenScorableCount(display);
    const spokenNorm = normalizeForComparison(spoken).length;
    expect(green).toBeLessThanOrEqual(spokenNorm + 2);
    expect(green).toBeLessThan(countScorableCharacters(MENGCHANGJUN_LINE) * 0.5);
  });

  it('Gemini full-paste guard: staging 孟嘗君 line does not 100% green', () => {
    const { matchRate, diffTokens } = evaluateGeminiPath(
      MENGCHANGJUN_LINE,
      '',
      MENGCHANGJUN_LINE,
      10_000,
    );
    const display = interleavePunctuation(MENGCHANGJUN_LINE, diffTokens);
    expect(matchRate).toBeLessThan(0.95);
    expect(greenScorableCount(display)).toBeLessThan(countScorableCharacters(MENGCHANGJUN_LINE));
  });

  it('interleave marks unread tail when diff tokens end early', () => {
    const target = '你好，世界！再見。';
    const tokens: DiffToken[] = [
      { char: '你', type: 'correct' },
      { char: '好', type: 'correct' },
    ];
    const display = interleavePunctuation(target, tokens);
    expect(display.find((t) => t.char === '世' && t.type === 'unread')).toBeDefined();
    expect(display.find((t) => t.char === '再' && t.type === 'unread')).toBeDefined();
  });
});

// ─── R4: 阿拉伯數字、中英文標點智慧轉換 ───────────────────────────────────

describe('R4 — number and punctuation normalization', () => {
  it('299 ↔ 二百九十九 full read', () => {
    const target = QIN_LINE;
    const spoken = '公元前二百九十九年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
  });

  it('partial read through digit run: digits green, rest missing', () => {
    const target = '公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';
    const spoken = '公元前二百九十九年';
    const display = displayChars(target, spoken);
    const digitTypes = display
      .filter((t) => /^[0-9]$/.test(t.char))
      .map((t) => `${t.char}:${t.type}`);
    expect(digitTypes).toEqual(['2:correct', '9:correct', '9:correct']);
    expect(display.find((t) => t.char === '秦' && t.type === 'missing')).toBeDefined();
    expect(display.filter((t) => t.type === 'correct').length).toBeLessThan(15);
  });

  it('兩百 spoken matches 二百 in target', () => {
    expect(diffCharacters('兩百', '二百', { useHomophone: true }).matchRate).toBe(1);
  });

  it('214 in target matches 兩百一十四 spoken', () => {
    expect(diffCharacters('兩百一十四', '214', { useHomophone: true }).matchRate).toBe(1);
  });

  it('full-width digits ２９９ match spoken 二百九十九', () => {
    const target = '公元前２９９年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';
    const spoken = '公元前二百九十九年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
  });

  it('partial read through full-width digit run interleaves digit UI correctly', () => {
    const target = '公元前２９９年，秦昭王';
    const spoken = '公元前二百九十九年';
    const display = displayChars(target, spoken);
    const digitTypes = display
      .filter((t) => /^[０-９0-9]$/.test(t.char))
      .map((t) => `${t.char}:${t.type}`);
    expect(digitTypes).toEqual(['２:correct', '９:correct', '９:correct']);
    expect(display.find((t) => t.char === '秦' && t.type === 'missing')).toBeDefined();
  });

  it('兩百 spoken vs 二百 target — interleave shows correct on 二', () => {
    const target = '二百個人';
    const spoken = '兩百個';
    const display = displayChars(target, spoken);
    expect(display.find((t) => t.char === '二' && t.type === 'correct')).toBeDefined();
    expect(display.find((t) => t.char === '人' && t.type === 'missing')).toBeDefined();
  });

  it('normalizePunctuationToChinese converts half-width', () => {
    expect(normalizePunctuationToChinese('你好, 世界.')).toBe('你好，世界。');
  });
});

// ─── R5: 同音／近音／STT 選字誤差仍算對 ───────────────────────────────────

describe('R5 — homophone, near-sound, and STT-equivalent forgiveness', () => {
  it('homophone substitution counts toward matchRate as forgiven', () => {
    const target = '他們去公園玩耍';
    const spoken = '他門去工園完刷'; // 門≈們, 工≈公, 完≈玩, 刷≈耍 near
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBeGreaterThan(0.8);
    expect(result.tokens.some((t) => t.type === 'forgiven')).toBe(true);
  });

  it('的/得/地 STT confusion → correct (not forgiven penalty)', () => {
    expect(isSttEquivalent('的', '得')).toBe(true);
    expect(isSttEquivalent('的', '地')).toBe(true);
    const result = diffCharacters('慢慢得走', '慢慢地走', { useHomophone: true });
    const deToken = result.tokens.find((t) => t.char === '地');
    expect(deToken?.type).toBe('correct');
  });

  it('homophone 工/公 counts as forgiven (same toneless pinyin)', () => {
    expect(isHomophone('工', '公')).toBe(true);
    const result = diffCharacters('工園', '公園', { useHomophone: true });
    expect(result.tokens.find((t) => t.char === '公')?.type).toBe('forgiven');
    expect(result.matchRate).toBe(1);
  });

  it('genuine wrong char (not homophone) stays wrong', () => {
    const result = diffCharacters('大樹', '小樹', { useHomophone: true });
    expect(result.wrongCount).toBeGreaterThan(0);
    expect(isHomophone('大', '小')).toBe(false);
  });

  it('analyzeFluency uses homophone-aware accuracy', () => {
    const target = '他們去公園玩耍';
    const fluency = analyzeFluency({
      spoken: '他門去工園完刷',
      target,
      durationMs: 8000,
      thresholds: { accuracyPass: 0.6, cpmPass: 0 },
    });
    expect(fluency.accuracy).toBeGreaterThanOrEqual(0.8);
    expect(fluency.accuracyPassed).toBe(true);
  });
});

// ─── R6: 正確率只算要唸的字（不含標點、注音、裝飾符號） ─────────────────

describe('R6 — accuracy denominator = scorable chars only', () => {
  it('bopomofo in target does not inflate denominator', () => {
    const target = '人ㄖㄣˊ';
    const spoken = '人';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
    expect(countScorableCharacters(target)).toBe(1);
  });

  it('decorative symbols and parenthetical notes stripped before compare', () => {
    const target = '你好~~~（旁白說明）世界';
    const spoken = '你好世界';
    const normTarget = normalizeForComparison(target);
    expect(normTarget).toBe('你好世界');
    expect(diffCharacters(spoken, target, { useHomophone: true }).matchRate).toBe(1);
  });

  it('matchRate uses correct+forgiven over scorable target length only', () => {
    const target = '一二三四，五六。';
    const spoken = '一二三四五六';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
    expect(result.correctCount).toBe(6);
  });

  it('filler chars stripped; non-filler extra tracked separately', () => {
    const target = '你好';
    const withFiller = diffCharacters('你好啊嗯', target, { useHomophone: true });
    expect(withFiller.matchRate).toBe(1);
    expect(withFiller.extraCount).toBe(0);

    const withExtra = diffCharacters('你好吧', target, { useHomophone: true });
    expect(withExtra.extraCount).toBeGreaterThan(0);
    expect(withExtra.matchRate).toBe(1);
  });
});

// ─── Appendix: rules from prior commits not in R1–R6 ───────────────────────

describe('Appendix — filler words stripped from diff', () => {
  it('嗯啊呃 filler chars excluded from spoken alignment', () => {
    const target = '我們去上學';
    const spoken = '嗯我們啊去上學呃';
    const result = diffCharacters(spoken, target, { useHomophone: true });
    expect(result.matchRate).toBe(1);
  });
});

describe('Appendix — cleanSpokenForDiff removes stutter duplicates', () => {
  it('collapses consecutive repeated hanzi', () => {
    const target = '你的書';
    expect(cleanSpokenForDiff('你你你的書', target)).toBe('你的書');
  });
});

describe('Appendix — extra tokens hidden in display interleave', () => {
  it('interleavePunctuation drops extra-type tokens from display', () => {
    const target = '你好';
    const tokens: DiffToken[] = [
      { char: '你', type: 'correct' },
      { char: '好', type: 'correct' },
      { char: '啊', type: 'extra' },
    ];
    const display = interleavePunctuation(target, tokens);
    expect(display.every((t) => t.type !== 'extra')).toBe(true);
  });
});

describe('Appendix — short paragraph pass threshold compensation', () => {
  it('≤5 chars lowers pass threshold by 0.2', () => {
    expect(getReadingPassThreshold(4)).toBeCloseTo(getReadingPassThreshold(100) - 0.2, 5);
  });

  it('≤10 chars lowers pass threshold by 0.1', () => {
    expect(getReadingPassThreshold(8)).toBeCloseTo(getReadingPassThreshold(100) - 0.1, 5);
  });
});

describe('Appendix — Gemini transcript guard (no STT recording needed)', () => {
  it('always runs guard for gemini source even when webSpeech empty', () => {
    const { conservativeClampApplied } = buildTranscriptForEvaluation({
      source: 'gemini',
      rawTranscript: MENGCHANGJUN_LINE,
      rawStt: '',
      targetText: MENGCHANGJUN_LINE,
      durationMs: 10_000,
    });
    expect(conservativeClampApplied).toBe(true);
  });

  it('Web Speech anchor when Gemini over-fills', () => {
    const web = '公元前299年';
    const { cleaned } = evaluateGeminiPath(QIN_LINE, web, QIN_LINE, 12_000);
    expect(cleaned).toBe(web);
  });
});

describe('Appendix — accuracy-only pass (speed display only, Issue #2131)', () => {
  it('slow but accurate reader still passes fluency gate', () => {
    const target = '春風吹過田野花兒開了我愛讀書學習進步';
    const result = analyzeFluency({
      spoken: target,
      target,
      durationMs: 30_000,
      thresholds: { cpmPass: 120, accuracyPass: 0.8 },
    });
    expect(result.accuracyPassed).toBe(true);
    expect(result.speedPassed).toBe(false);
    expect(result.passed).toBe(true);
  });
});
