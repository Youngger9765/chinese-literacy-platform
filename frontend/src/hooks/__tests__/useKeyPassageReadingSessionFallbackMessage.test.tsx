/**
 * 真 hook 把後端的 `reason` 接到學生看到的那句話（#3299）。
 *
 * ⚠️ 為什麼一定要掛真 hook：`transcribeFallbackMessage.test.ts` 只驗純函式
 *    （「給 `empty` 會回什麼」），它證明不了 hook 真的把 `result.reason` 傳進去。
 *    實測過：把 `setMicError(transcribeFallbackMessage(result.reason))` 改成寫死
 *    `'error'`，純函式那支照樣全綠，而學生在錄音太短時會被叫去「再按一次完成」。
 *
 *    我第一版的這支測試在檔案裡自己複製了一份分支邏輯，mutation 不咬 —— 那是裝飾品。
 *    這一版 render 真的 `useKeyPassageReadingSession`，只把錄音器與後端呼叫換成替身。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const transcribeReading = vi.fn();
const stopAndGetBlob = vi.fn();

vi.mock('../useAudioRecorder', () => ({
  FULL_READING_MAX_SECONDS: 300,
  useAudioRecorder: () => ({
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(),
    stopAndGetBlob: (...a: unknown[]) => stopAndGetBlob(...a),
    getPeakVolume: () => 0.5,          // 過得了前端靜音門檻
    reachedMaxDuration: false,
    audioUrl: null,
    audioBlob: null,
    status: 'idle',
  }),
}));
vi.mock('../../services/learning/session', () => ({
  transcribeReading: (...a: unknown[]) => transcribeReading(...a),
  saveReadingAudio: vi.fn(async () => ({ ok: true, attempt_id: 1 })),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'tok' }) }));

// 有別的模組在呼叫 navigator.mediaDevices.getUserMedia（不是我替身掉的錄音器）。
// 給一個 stub —— 這一條要鎖的是「reason 有沒有被傳進去」，不是瀏覽器取得麥克風。
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
});

import { useKeyPassageReadingSession } from '../useKeyPassageReadingSession';

function mount() {
  return renderHook(() =>
    useKeyPassageReadingSession({
      fullText: '春天來了，花園裡開滿了美麗的花朵，小鳥在枝頭上唱歌。',
      token: 'tok',
      storyId: 20001,
      dbSessionId: 1,
      stopTtsAll: vi.fn(),
      onResultReady: vi.fn(),
    }),
  );
}

async function runWithReason(reason: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stopAndGetBlob.mockResolvedValue(new Blob([new Uint8Array(4096)], { type: 'audio/webm' }));
  transcribeReading.mockResolvedValue({ transcript: null, method: 'fallback', reasoning: '', reason });
  const { result } = mount();
  const t0 = Date.now();
  await act(async () => { await result.current.startSession(); });
  // 前端還有一道靜音門檻（`validateRecording`，#2321/#2362），它同時看音量與**長度**。
  // start 與 submit 之間幾乎沒有時間差，所以要把系統時鐘推過那個下限 ——
  // ⛔ 不去 stub `validateRecording`：那是產品邏輯，stub 掉這條鎖就跨過了真實路徑。
  vi.setSystemTime(t0 + 30_000);
  await act(async () => { await result.current.submitReading(); });
  vi.useRealTimers();
  await waitFor(() => expect(result.current.micError).toBeTruthy(), { timeout: 3000 });
  return result.current.micError;
}

describe('#3299 真 hook：後端的 reason → 學生看到的訊息', () => {
  beforeEach(() => { transcribeReading.mockReset(); stopAndGetBlob.mockReset(); });

  it('reason=too_short → 叫他把整段唸完，不是「再按一次」', async () => {
    const m = await runWithReason('too_short');
    expect(m).toMatch(/太短|唸完/);
    expect(m).not.toMatch(/^辨識失敗/);
  });

  it('reason=decode（錄音太長）→ 叫他分段', async () => {
    expect(await runWithReason('decode')).toMatch(/太長|分成小段/);
  });

  it('⭐ 太短與逾時必須拿到不同的話 —— 這條抓的是「hook 把 reason 寫死」', async () => {
    const shortMsg = await runWithReason('too_short');
    const timeoutMsg = await runWithReason('timeout');
    expect(shortMsg).not.toBe(timeoutMsg);
  });
});
