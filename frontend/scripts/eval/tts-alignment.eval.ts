// @vitest-environment jsdom
/**
 * EDD eval — #2607 (Intro AI 朗讀全文): does the REAL narration path actually
 * send canonical-aligned text to the backend?
 *
 * REVISION HISTORY (see PR #2608 discussion, 2026-08-07):
 *   v1 (this file, first cut) computed SHA-256(frontend cleanForTts+splitSentences
 *   applied directly to the raw story paragraph) and compared that against the
 *   backend's canonical mapping hashes. Result: 61.3% (272/444) — a real failure,
 *   but team-lead + independent re-verification found it was measuring the WRONG
 *   thing: `_speakViaBackendWithProgress` (ttsApi.ts) does
 *     `sentences = canonical ?? _splitSentences(_cleanForTts(text))`
 *   — when lessonId+paragraphIdx are passed (which Intro's production code
 *   ALWAYS does), a successful canonical lookup short-circuits and the
 *   frontend's own cleanForTts/splitSentences never runs at all. v1 was
 *   therefore benchmarking the FALLBACK path (only taken when the mapping
 *   fetch itself fails), not the path Intro actually exercises. The 61.3%
 *   mismatch traces to _clean_for_tts transforms (e.g. "~~~" removal, "──" →
 *   "，") plus the fact the backend computes each cache key from the RAW
 *   pre-cleaning text (backend/app/services/tts/__init__.py:synthesize_speech,
 *   `key = _cache_key(text)` at line 268, BEFORE `_clean_for_tts` at line 287)
 *   — none of which is a bug, and none of which is reachable from Intro's real
 *   call path. Do NOT "fix" _cleanForTts/_splitSentences to chase this number;
 *   they're correct for what they're for (a robustness fallback, not cache
 *   alignment).
 *
 *   v2 (this rewrite) tests the actual reachable path instead: run the REAL
 *   `speakTextWithProgress()` (imported from ttsApi.ts, not reimplemented)
 *   exactly as Intro.tsx's speakParagraphAt calls it — WITH lessonId +
 *   paragraphIdx — for every paragraph of 10 real staging lessons, and assert
 *   every resulting POST /api/tts/synthesize request body is a sentence that
 *   actually appears in that lesson's canonical mapping. fetch is only mocked
 *   for the synthesize POST (to avoid needing auth / burning real TTS quota);
 *   the mapping GET and the story-content GET both use real network data,
 *   pre-fetched before the mock is installed.
 *
 * Scope, deliberately narrow (per team-lead direction, 2026-08-07):
 *   - ONLY checks whether the text sent to /api/tts/synthesize is a KEY the
 *     backend recognises. Does NOT check whether audio actually exists at
 *     that key in GCS, and does NOT check playback latency — the GCS
 *     sentence cache was nearly emptied by a lifecycle rule (removed
 *     2026-08-07, not yet backfilled), so any audio-existence/latency
 *     assertion would fail for reasons unrelated to alignment.
 *
 * Excluded from `npm run test` (own vitest config, scripts/eval/vitest.eval.config.ts)
 * because it makes real network calls to staging. Run explicitly:
 *   npx vitest run --config scripts/eval/vitest.eval.config.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speakTextWithProgress } from '../../src/services/ttsApi';

const STAGING_API = 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

// Same 10 lessons as the v1 cut — spread across the catalog, chosen before
// running, not cherry-picked for a good result.
const SAMPLE_LESSON_IDS = [1, 7, 15, 30, 44, 1001, 1065, 1090, 1115, 1140];

interface StoryDetailResponse {
  paragraphs: string[];
}

interface MappingResponse {
  lesson_id: number;
  paragraphs: Array<{ index: number; sentences: Array<{ text: string; hash: string }> }>;
}

async function fetchJsonReal<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Mocks for the synthesize-call interception phase ───────────────────────
// Audio fires 'ended' on the next microtask after play() — just needs to let
// _speakViaBackendWithProgress's sentence loop run to completion; timing
// fidelity doesn't matter for this eval (unlike Intro.aiTts.test.tsx, which
// deliberately controls it to test UI state transitions).
class AutoEndAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  currentTime = 0;
  duration = 1;
  src: string;
  constructor(src?: string) {
    this.src = src ?? '';
  }
  play() {
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
  pause() {}
}

let synthesizeCallTexts: string[];
let realFetch: typeof fetch;

beforeEach(() => {
  synthesizeCallTexts = [];
  realFetch = globalThis.fetch;
  vi.stubGlobal('Audio', AutoEndAudio);
  // NOTE: URL is deliberately NOT stubbed here. jsdom's real fetch (used for
  // the pre-fetch phase below, before the synthesize interceptor is
  // installed) needs the real `URL` constructor internally to parse request
  // URLs — stubbing it globally with a plain object (as Intro.aiTts.test.tsx
  // does, safe there because that file mocks fetch entirely) breaks real
  // fetch with "URL is not a constructor". createObjectURL/revokeObjectURL
  // are added via installSynthesizeInterceptor() instead, once real network
  // calls are done.
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Installs a fetch mock that:
 *  - answers GET /api/tts/mapping/{lessonId} from pre-fetched REAL data
 *    (no repeat network call, but the data itself came from staging)
 *  - intercepts POST /api/tts/synthesize, records body.text, returns a fake
 *    audio blob (no real TTS call — avoids needing auth and burning quota)
 *  - anything else falls through to the real fetch (shouldn't be hit)
 */
function installSynthesizeInterceptor(mappingByLessonId: Map<number, MappingResponse>) {
  // Safe to stub now — all real network calls (the pre-fetch phase) are done.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      const mappingMatch = urlStr.match(/\/api\/tts\/mapping\/(\d+)/);
      if (mappingMatch) {
        const lessonId = Number(mappingMatch[1]);
        const mapping = mappingByLessonId.get(lessonId);
        if (mapping) {
          return { ok: true, json: () => Promise.resolve(mapping) } as Response;
        }
        return { ok: false, json: () => Promise.resolve({}) } as Response;
      }
      if (urlStr.includes('/api/tts/synthesize')) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        synthesizeCallTexts.push(body.text as string);
        return {
          ok: true,
          blob: () => Promise.resolve(new Blob(['audio-bytes'], { type: 'audio/mpeg' })),
        } as Response;
      }
      return realFetch(url, init);
    }),
  );
}

describe('TTS canonical alignment: the REAL narration path (speakTextWithProgress with lessonId+paragraphIdx) — #2607 EDD v2', () => {
  it('every /api/tts/synthesize call Intro would make sends text that exists in the canonical mapping, across 10 real staging lessons', async () => {
    expect(SAMPLE_LESSON_IDS.length).toBeGreaterThanOrEqual(10);

    // Pre-fetch REAL data with the real fetch, before any mock is installed.
    const storyByLessonId = new Map<number, StoryDetailResponse>();
    const mappingByLessonId = new Map<number, MappingResponse>();
    for (const lessonId of SAMPLE_LESSON_IDS) {
      const [story, mapping] = await Promise.all([
        fetchJsonReal<StoryDetailResponse>(`${STAGING_API}/api/stories/${lessonId}`),
        fetchJsonReal<MappingResponse>(`${STAGING_API}/api/tts/mapping/${lessonId}`),
      ]);
      storyByLessonId.set(lessonId, story);
      mappingByLessonId.set(lessonId, mapping);
    }

    installSynthesizeInterceptor(mappingByLessonId);

    let totalParagraphs = 0;
    const misalignedCalls: string[] = [];

    for (const lessonId of SAMPLE_LESSON_IDS) {
      const story = storyByLessonId.get(lessonId)!;
      const mapping = mappingByLessonId.get(lessonId)!;
      const canonicalTextsByParagraph = new Map<number, Set<string>>(
        mapping.paragraphs.map((p) => [p.index, new Set(p.sentences.map((s) => s.text))]),
      );

      for (let idx = 0; idx < story.paragraphs.length; idx++) {
        const paragraph = story.paragraphs[idx];
        if (!paragraph?.trim()) continue;
        totalParagraphs += 1;

        const callsBefore = synthesizeCallTexts.length;
        // This is EXACTLY what Intro.tsx's speakParagraphAt calls (via speakText
        // → the v2 branch of useTtsPlayback) — the real function, real args.
        await speakTextWithProgress(paragraph, () => {}, lessonId, idx);
        const callsForThisParagraph = synthesizeCallTexts.slice(callsBefore);

        const canonicalTexts = canonicalTextsByParagraph.get(idx) ?? new Set<string>();
        for (const sentText of callsForThisParagraph) {
          if (!canonicalTexts.has(sentText)) {
            misalignedCalls.push(
              `lesson ${lessonId} ¶${idx}: sent "${sentText.slice(0, 24)}${sentText.length > 24 ? '…' : ''}" — not in canonical set (${canonicalTexts.size} entries)`,
            );
          }
        }
      }
    }

    // eslint-disable-next-line no-console -- this IS the eval's report
    console.log(
      [
        `Checked ${totalParagraphs} paragraphs across ${SAMPLE_LESSON_IDS.length} lessons.`,
        `Synthesize calls made: ${synthesizeCallTexts.length}.`,
        `Misaligned: ${misalignedCalls.length}.`,
        ...misalignedCalls.slice(0, 10),
      ].join('\n'),
    );

    expect(totalParagraphs).toBeGreaterThan(0);
    expect(synthesizeCallTexts.length).toBeGreaterThan(0);
    // The real path must NEVER send non-canonical text when a mapping exists
    // for that paragraph — this is the actual guarantee Intro's cache-hit
    // design depends on.
    expect(misalignedCalls).toEqual([]);
  }, 60_000);
});
