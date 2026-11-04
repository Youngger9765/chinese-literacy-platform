/**
 * #3856 — AI 關閉時「重點朗讀」必須仍可完成，不能永遠卡在 503。
 *
 * 背景：`progressRecheck3694.spec.ts` 在 staging 連兩次 CI 跑到 15 分鐘整
 * (`test.describe.configure({ timeout: 900_000 })`) 逾時。真實重現（curl +
 * 真瀏覽器打 staging）確認：`AI_FEATURES_ENABLED` 關閉時 `/api/reading/transcribe`
 * 回 503，前端把它當成通用的「剛剛出了點小狀況，再按一次完成試試看」——但這個
 * 「再試一次」永遠不會成功，而「重點朗讀」是 11 個必做步驟之一，完成判定完全
 * 綁在 Gemini 成功回傳後才設定的 `result` state 上，沒有任何非 AI 的完成路徑。
 *
 * ⚠️ 跟 `useKeyPassageReadingSessionFallbackMessage.test.tsx` 同一個理由：一定要
 *    render 真的 `useKeyPassageReadingSession`，不要在測試裡自己複製一份「AI 關閉就
 *    跳過」的邏輯 —— 那樣 mutation 不會咬，測試只是在驗證自己抄的那份。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const transcribeReading = vi.fn();
const saveReadingHistory = vi.fn();
const saveReadingAudio = vi.fn();
const stopAndGetBlob = vi.fn();
let aiFeaturesEnabled = true;

vi.mock('../useAudioRecorder', () => ({
  FULL_READING_MAX_SECONDS: 300,
  useAudioRecorder: () => ({
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(),
    stopAndGetBlob: (...a: unknown[]) => stopAndGetBlob(...a),
    getPeakVolume: () => 0.5, // 過得了前端靜音門檻
    reachedMaxDuration: false,
    audioUrl: null,
    audioBlob: null,
    status: 'idle',
  }),
}));
vi.mock('../../services/learning/session', () => ({
  transcribeReading: (...a: unknown[]) => transcribeReading(...a),
  saveReadingAudio: (...a: unknown[]) => saveReadingAudio(...a),
}));
vi.mock('../../services/readingHistoryApi', () => ({
  saveReadingHistory: (...a: unknown[]) => saveReadingHistory(...a),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'tok' }) }));
// #3838 kill switch 前端鏡像 —— 這支測試唯一要控制的開關。
vi.mock('../useAiFeaturesEnabled', () => ({
  useAiFeaturesEnabled: () => aiFeaturesEnabled,
}));

Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
});

import { useKeyPassageReadingSession, type SavedResult } from '../useKeyPassageReadingSession';

async function submitOnce(onResultReady: (result: SavedResult, transcript: string) => void) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stopAndGetBlob.mockResolvedValue(new Blob([new Uint8Array(4096)], { type: 'audio/webm' }));
  const { result } = renderHook(() =>
    useKeyPassageReadingSession({
      fullText: '春天來了，花園裡開滿了美麗的花朵，小鳥在枝頭上唱歌。',
      token: 'tok',
      storyId: 20017,
      dbSessionId: 1,
      stopTtsAll: vi.fn(),
      onResultReady,
    }),
  );
  const t0 = Date.now();
  await act(async () => { await result.current.startSession(); });
  // 跨過前端的靜音/太短門檻（跟 fallback-message 測試同理，不 stub 掉真實路徑）。
  vi.setSystemTime(t0 + 30_000);
  await act(async () => { await result.current.submitReading(); });
  vi.useRealTimers();
  return result.current;
}

describe('#3856 AI 關閉時「重點朗讀」仍可完成', () => {
  beforeEach(() => {
    transcribeReading.mockReset();
    saveReadingHistory.mockReset();
    saveReadingAudio.mockReset();
    stopAndGetBlob.mockReset();
    aiFeaturesEnabled = true;
  });

  it('AI 關閉 → 完全不打 /reading/transcribe，直接用自我評估完成這一關', async () => {
    aiFeaturesEnabled = false;
    const onResultReady = vi.fn();
    await submitOnce(onResultReady);

    await waitFor(() => expect(onResultReady).toHaveBeenCalled());
    // 根因就是這支永遠 503，AI 關閉時完全不該再打它。
    expect(transcribeReading).not.toHaveBeenCalled();

    const [savedResult] = onResultReady.mock.calls[0];
    expect(savedResult.aiDisabled).toBe(true);
  });

  it('AI 關閉 → 不寫入 reading history（避免假的 0 分污染長期流暢度分析）', async () => {
    aiFeaturesEnabled = false;
    await submitOnce(vi.fn());
    expect(saveReadingHistory).not.toHaveBeenCalled();
  });

  it('⭐ regression：AI 開啟時完全不受影響 —— 照樣打 /reading/transcribe', async () => {
    aiFeaturesEnabled = true;
    transcribeReading.mockResolvedValue({
      transcript: '春天來了，花園裡開滿了美麗的花朵，小鳥在枝頭上唱歌。',
      method: 'gemini',
      reasoning: '',
    });
    const onResultReady = vi.fn();
    await submitOnce(onResultReady);

    await waitFor(() => expect(onResultReady).toHaveBeenCalled());
    expect(transcribeReading).toHaveBeenCalledTimes(1);
    const [savedResult] = onResultReady.mock.calls[0];
    expect(savedResult.aiDisabled).toBeFalsy();
  });
});
