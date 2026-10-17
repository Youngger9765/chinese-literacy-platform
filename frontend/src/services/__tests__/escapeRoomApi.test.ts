import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EscapeRoomApiError,
  startEscapeRoomRun,
  submitEscapeRoomAnswer,
  submitEscapeRoomGateAnswer,
} from '../escapeRoomApi';

describe('escapeRoomApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('建立一局時送出授權與範圍', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ run_id: 42 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(startEscapeRoomRun('憑證', { scope_type: 'grade_pool', scope_ref: '4' })).resolves.toEqual({ run_id: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/escape-room/runs'),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer 憑證' }) }),
    );
  });

  it('將 FastAPI 422 陣列換成學生可讀的通用中文訊息', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: [{ msg: 'field required' }] }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(startEscapeRoomRun('憑證', { scope_type: 'grade_pool', scope_ref: '4' })).rejects.toMatchObject({
      name: EscapeRoomApiError.name,
      message: '發生錯誤，請稍後再試一次',
      status: 422,
    });
  });

  it('保留後端提供的中文訊息', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '這一局已經結束' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(startEscapeRoomRun('憑證', { scope_type: 'grade_pool', scope_ref: '4' })).rejects.toMatchObject({ message: '這一局已經結束' });
  });

  it('機關與大門作答只送統一契約的答案欄位', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await submitEscapeRoomAnswer('憑證', 42, { chamber_index: 2, choice_key: 'A' });
    await submitEscapeRoomGateAnswer('憑證', 42, { choice_key: 'B' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/runs/42/answer'),
      expect.objectContaining({ body: JSON.stringify({ chamber_index: 2, choice_key: 'A' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/runs/42/gate-answer'),
      expect.objectContaining({ body: JSON.stringify({ choice_key: 'B' }) }),
    );
  });
});
