// @vitest-environment node
/**
 * EDD eval — #2607 (Intro AI 朗讀全文): does the FRONTEND's actual sentence
 * splitter agree with the BACKEND's canonical TTS cache?
 *
 * Why this exists: Intro's AI 朗讀全文 button (frontend/src/components/reading-steps/Intro.tsx)
 * now narrates story.content paragraph-by-paragraph via useTtsPlayback, passing
 * lessonId + paragraphIdx so each call can hit the backend's pre-generated
 * sentence cache (GET /api/tts/mapping/{lessonId}, keyed by SHA-256 of each
 * canonical sentence — backend/app/services/tts/normalization.py:_cache_key).
 * If the frontend's own sentence splitter (ttsApi.ts's cleanForTts +
 * splitSentences) disagrees with what the backend considers "the same
 * sentence", every paragraph pays a live 8-15s synthesis instead of a cache
 * hit — silently, with no error, just a slow first play every time.
 *
 * This measures that agreement directly against real staging data, using the
 * REAL frontend functions (imported from src/services/ttsApi.ts, not
 * reimplemented here) — not a judge, not a vibe check. Deterministic only:
 * a sentence either hashes to something in the backend's canonical set, or it
 * doesn't.
 *
 * Scope, deliberately narrow (per team-lead direction, 2026-08-07):
 *   - ONLY checks whether SHA-256(frontend sentence) is a KEY the backend
 *     recognises. Does NOT check whether audio actually exists at that key in
 *     GCS, and does NOT check playback latency — the GCS sentence cache was
 *     nearly emptied by a lifecycle rule (since removed 2026-08-07, but not yet
 *     backfilled), so any audio-existence or latency assertion would be
 *     comparing against an empty cache and fail for reasons unrelated to
 *     alignment. That is a separate, already-tracked problem — this eval's job
 *     is narrower: "if the cache WERE warm, would this sentence hit it?"
 *
 * Excluded from `npm run test` (see vite.config.ts `test.exclude`) because it
 * makes real network calls to staging — not something every CI run should
 * depend on. Run explicitly:
 *   npx vitest run scripts/eval/tts-alignment.eval.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { _testInternals } from '../../src/services/ttsApi';

const STAGING_API = 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

// >=10 lessons spread across the catalog (low + high lesson_number ranges) —
// not cherry-picked for a good result; chosen before running, same lesson set
// the 8/8 course_intro sampling used (PR #2608) plus 2 more for the >=10 floor.
const SAMPLE_LESSON_IDS = [1, 7, 15, 30, 44, 1001, 1065, 1090, 1115, 1140];

const MIN_ALIGNMENT_RATE = 0.95;

interface StoryDetailResponse {
  paragraphs: string[];
}

interface MappingResponse {
  lesson_id: number;
  paragraphs: Array<{ index: number; sentences: Array<{ text: string; hash: string }> }>;
}

/** Mirrors backend/app/services/tts/normalization.py:_cache_key exactly. */
function cacheKey(text: string): string {
  return createHash('sha256').update(text.trim(), 'utf8').digest('hex');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface AlignmentResult {
  lessonId: number;
  totalSentences: number;
  matchedSentences: number;
  mismatches: string[];
}

async function checkLessonAlignment(lessonId: number): Promise<AlignmentResult> {
  const [story, mapping] = await Promise.all([
    fetchJson<StoryDetailResponse>(`${STAGING_API}/api/stories/${lessonId}`),
    fetchJson<MappingResponse>(`${STAGING_API}/api/tts/mapping/${lessonId}`),
  ]);

  const canonicalHashesByParagraph = new Map<number, Set<string>>(
    mapping.paragraphs.map((p) => [p.index, new Set(p.sentences.map((s) => s.hash))]),
  );

  let totalSentences = 0;
  let matchedSentences = 0;
  const mismatches: string[] = [];

  story.paragraphs.forEach((paragraph, idx) => {
    const cleaned = _testInternals.cleanForTts(paragraph);
    if (!cleaned) return;
    const sentences = _testInternals.splitSentences(cleaned);
    const canonicalHashes = canonicalHashesByParagraph.get(idx) ?? new Set<string>();

    for (const sentence of sentences) {
      if (!sentence.trim()) continue;
      totalSentences += 1;
      const hash = cacheKey(sentence);
      if (canonicalHashes.has(hash)) {
        matchedSentences += 1;
      } else {
        mismatches.push(`lesson ${lessonId} ¶${idx}: "${sentence.slice(0, 24)}${sentence.length > 24 ? '…' : ''}"`);
      }
    }
  });

  return { lessonId, totalSentences, matchedSentences, mismatches };
}

describe('TTS sentence-hash alignment: frontend cleanForTts/splitSentences vs backend canonical mapping (#2607 EDD)', () => {
  it(`>=10 lessons: sentence-level SHA-256 alignment rate >= ${MIN_ALIGNMENT_RATE * 100}%`, async () => {
    expect(SAMPLE_LESSON_IDS.length).toBeGreaterThanOrEqual(10);

    const results = await Promise.all(SAMPLE_LESSON_IDS.map(checkLessonAlignment));

    const totalSentences = results.reduce((sum, r) => sum + r.totalSentences, 0);
    const matchedSentences = results.reduce((sum, r) => sum + r.matchedSentences, 0);
    const allMismatches = results.flatMap((r) => r.mismatches);
    const alignmentRate = totalSentences > 0 ? matchedSentences / totalSentences : 0;

    // eslint-disable-next-line no-console -- this IS the eval's report, meant to be read
    console.log(
      [
        `TTS alignment: ${matchedSentences}/${totalSentences} sentences = ${(alignmentRate * 100).toFixed(1)}%`,
        ...results.map((r) => `  lesson ${r.lessonId}: ${r.matchedSentences}/${r.totalSentences}`),
        allMismatches.length > 0
          ? `Mismatches (${allMismatches.length} total, first 10):\n  ${allMismatches.slice(0, 10).join('\n  ')}`
          : 'No mismatches.',
      ].join('\n'),
    );

    expect(totalSentences).toBeGreaterThan(0);
    expect(alignmentRate).toBeGreaterThanOrEqual(MIN_ALIGNMENT_RATE);
  }, 30_000);
});
