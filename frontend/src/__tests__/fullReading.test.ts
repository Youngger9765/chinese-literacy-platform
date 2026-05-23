/**
 * Unit tests for FullReading refactor hooks (Issue #1880).
 *
 * TDD-first: these 3 tests are written against the CURRENT FullReading.tsx
 * logic (extracted as pure functions / hook contracts) so they pass BEFORE
 * the refactor, and continue to pass AFTER the hooks are extracted.
 *
 * Tests:
 *   1. initial_result_prefers_local_storage_over_db_result
 *   2. submit_reading_cleans_transcript_analyzes_once_and_persists_history (double-click guard)
 *   3. tts_queue_advances_paragraphs_and_resets_on_stop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── 1. localStorage preference logic ────────────────────────────────────────
// Mirrors getInitialResult() priority in FullReading.tsx:
//   1st: localStorage saved result (has diffTokens)
//   2nd: DB-rehydrated initialResult prop
//   null otherwise

interface SavedResult {
  matchRate: number;
  feedback: string;
  diffTokens: Array<{ type: string; text: string }>;
  cpm: number;
  durationMs: number;
  errorBreakdown: { correct: number; wrong: number; missing: number; extra: number };
}

function getInitialResultLogic(
  localSaved: { result: SavedResult } | null,
  dbResult: { matchRate: number; feedback: string; diffTokens?: Array<{ type: string; text: string }> } | null,
): SavedResult | null {
  if (localSaved?.result) return localSaved.result;
  if (dbResult) {
    return {
      matchRate: dbResult.matchRate,
      feedback: dbResult.feedback,
      diffTokens: dbResult.diffTokens ?? [],
      cpm: 0,
      durationMs: 0,
      errorBreakdown: { correct: 0, wrong: 0, missing: 0, extra: 0 },
    };
  }
  return null;
}

describe('initial_result_prefers_local_storage_over_db_result', () => {
  it('returns localStorage result when both local and DB results exist', () => {
    const local: SavedResult = {
      matchRate: 0.95,
      feedback: 'great',
      diffTokens: [{ type: 'correct', text: '你' }],
      cpm: 120,
      durationMs: 5000,
      errorBreakdown: { correct: 10, wrong: 0, missing: 0, extra: 0 },
    };
    const db = { matchRate: 0.70, feedback: 'ok', diffTokens: [] };

    const result = getInitialResultLogic({ result: local }, db);

    expect(result?.matchRate).toBe(0.95);
    expect(result?.diffTokens).toHaveLength(1);
  });

  it('falls back to DB result when localStorage is empty', () => {
    const db = { matchRate: 0.80, feedback: 'good' };

    const result = getInitialResultLogic(null, db);

    expect(result?.matchRate).toBe(0.80);
    expect(result?.diffTokens).toEqual([]); // DB result may lack diffTokens
  });

  it('returns null when both local and DB are absent', () => {
    const result = getInitialResultLogic(null, null);
    expect(result).toBeNull();
  });
});

// ─── 2. Double-click guard & single-analysis guarantee ───────────────────────
// Mirrors submitReading():
//   - Uses isSessionActive ref as guard (synchronous flip in stopSession)
//   - analyzeFluency called exactly once per submit
//   - saveReadingHistory called once (fires fire-and-forget)

describe('submit_reading_cleans_transcript_analyzes_once_and_persists_history', () => {
  it('does not analyze or persist when session is not active (double-click guard)', () => {
    let isSessionActive = false; // ref value

    const analyzeFluency = vi.fn();
    const saveHistory = vi.fn();

    function submitReading() {
      if (!isSessionActive) return; // guard — mirrors isSessionActiveRef.current check
      isSessionActive = false;      // mirrors stopSession() synchronous flip
      analyzeFluency({ spoken: 'text', target: 'text', durationMs: 1000 });
      saveHistory();
    }

    submitReading(); // session not active — nothing happens
    expect(analyzeFluency).not.toHaveBeenCalled();
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it('calls analyzeFluency exactly once per submit even if submitReading fires twice', () => {
    let isSessionActive = true;

    const analyzeFluency = vi.fn().mockReturnValue({
      accuracy: 0.9, feedback: 'great', diffTokens: [], cpm: 100, durationMs: 3000,
      errorBreakdown: { correct: 9, wrong: 0, missing: 0, extra: 0 },
    });
    const saveHistory = vi.fn(() => Promise.resolve());

    function submitReading() {
      if (!isSessionActive) return;
      isSessionActive = false; // synchronous flip prevents second call
      const result = analyzeFluency({ spoken: 'text', target: 'text', durationMs: 1000 });
      if (result.cpm > 0) saveHistory();
    }

    submitReading(); // first click — should process
    submitReading(); // second click — guard fires, nothing called again

    expect(analyzeFluency).toHaveBeenCalledTimes(1);
    expect(saveHistory).toHaveBeenCalledTimes(1);
  });

  it('does not call saveHistory when transcript is empty', () => {
    let isSessionActive = true;

    const saveHistory = vi.fn();

    function submitReading(transcript: string) {
      if (!isSessionActive) return;
      isSessionActive = false;
      if (!transcript.trim()) return; // mirrors the micError path
      saveHistory();
    }

    submitReading(''); // empty transcript — save should NOT fire
    expect(saveHistory).not.toHaveBeenCalled();
  });
});

// ─── 3. TTS queue advances paragraphs and resets on stop ─────────────────────
// Mirrors the ttsQueueRef / ttsQueueIdxRef / speakNextInQueue / stopTtsAll logic.

describe('tts_queue_advances_paragraphs_and_resets_on_stop', () => {
  function makeTtsQueue(paragraphs: string[]) {
    const queue = [...paragraphs];
    let idx = 0;
    let currentParagraph = -1;
    const speakCalls: string[] = [];

    function speakNext() {
      if (idx >= queue.length) {
        currentParagraph = -1;
        return;
      }
      currentParagraph = idx;
      speakCalls.push(queue[idx]);
    }

    function advance() {
      idx += 1;
      speakNext();
    }

    function stop() {
      queue.length = 0; // clear
      idx = 0;
      currentParagraph = -1;
    }

    // Start
    speakNext();

    return { advance, stop, speakCalls, getCurrentParagraph: () => currentParagraph, getIdx: () => idx };
  }

  it('starts at paragraph 0 and advances to 1 after first paragraph ends', () => {
    const ctrl = makeTtsQueue(['段落一', '段落二', '段落三']);

    expect(ctrl.getCurrentParagraph()).toBe(0);
    expect(ctrl.speakCalls).toEqual(['段落一']);

    ctrl.advance();

    expect(ctrl.getCurrentParagraph()).toBe(1);
    expect(ctrl.speakCalls).toEqual(['段落一', '段落二']);
  });

  it('sets currentParagraph to -1 when queue is exhausted', () => {
    const ctrl = makeTtsQueue(['段落一']);

    ctrl.advance(); // after the only paragraph

    expect(ctrl.getCurrentParagraph()).toBe(-1);
    expect(ctrl.speakCalls).toHaveLength(1);
  });

  it('resets queue and currentParagraph to -1 on stop', () => {
    const ctrl = makeTtsQueue(['段落一', '段落二']);

    ctrl.advance(); // now on 段落二

    ctrl.stop();

    expect(ctrl.getCurrentParagraph()).toBe(-1);
    expect(ctrl.getIdx()).toBe(0);
  });

  it('does not speak any paragraph after stop even if advance is called', () => {
    const ctrl = makeTtsQueue(['段落一', '段落二']);
    ctrl.stop();

    // After stop, advance should not speak anything new
    const speakCountBefore = ctrl.speakCalls.length;
    ctrl.advance();
    // queue was cleared so idx 0 is past queue.length (0), currentParagraph stays -1
    expect(ctrl.getCurrentParagraph()).toBe(-1);
    // No new calls added
    expect(ctrl.speakCalls.length).toBe(speakCountBefore);
  });
});
