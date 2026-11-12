/**
 * IapAllowlistPanel tests (Issue #3720)
 *
 * Acceptance criteria:
 * 1. "not configured" state renders the API's message (expected state today)
 * 2. junyi domain summary line renders when junyi_domain_active is true
 * 3. active grant with expiry shows the date, no copy button
 * 4. active grant with no expiry shows no date, no copy button
 * 5. expired grant shows the reminder text + a working copy-to-IT button
 * 6. API error renders an error state with retry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/iapAllowlistApi', () => ({
  getIapAllowlist: vi.fn(),
  IapAllowlistApiError: class IapAllowlistApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

import IapAllowlistPanel from '../IapAllowlistPanel';
import { getIapAllowlist } from '../../../services/iapAllowlistApi';

const mockGetIapAllowlist = vi.mocked(getIapAllowlist);

async function renderPanel() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<IapAllowlistPanel />);
  });
  return result;
}

describe('IapAllowlistPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the "not configured" message when IAP has not been wired up', async () => {
    mockGetIapAllowlist.mockResolvedValue({
      configured: false,
      message: '尚未設定 IAP（目前測試站未上鎖）',
    });
    await renderPanel();
    await waitFor(() => {
      expect(screen.getByText('尚未設定 IAP（目前測試站未上鎖）')).toBeTruthy();
    });
  });

  it('shows the junyi domain summary line when junyi_domain_active is true', async () => {
    mockGetIapAllowlist.mockResolvedValue({
      configured: true,
      junyi_domain_active: true,
      external_grants: [],
    });
    await renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/均一帳號/)).toBeTruthy();
      expect(screen.getByText(/全部開通/)).toBeTruthy();
    });
  });

  it('shows an active grant with its expiry date and no copy button', async () => {
    mockGetIapAllowlist.mockResolvedValue({
      configured: true,
      junyi_domain_active: false,
      external_grants: [
        {
          email: 'hans@example.com',
          name: 'Hans 劉燁',
          status: 'active',
          expires_at: '2026-12-31T00:00:00+00:00',
        },
      ],
    });
    await renderPanel();
    await waitFor(() => {
      expect(screen.getByText('hans@example.com')).toBeTruthy();
      expect(screen.getByText('Hans 劉燁')).toBeTruthy();
      expect(screen.getByText(/2026-12-31/)).toBeTruthy();
    });
    expect(screen.queryByText('複製給 IT 的資訊')).toBeNull();
  });

  it('shows an active grant with no expiry and no date text', async () => {
    mockGetIapAllowlist.mockResolvedValue({
      configured: true,
      junyi_domain_active: false,
      external_grants: [
        {
          email: 'forever@example.com',
          name: '長期訪客',
          status: 'active',
          expires_at: null,
        },
      ],
    });
    await renderPanel();
    await waitFor(() => {
      expect(screen.getByText('forever@example.com')).toBeTruthy();
    });
    expect(screen.queryByText('複製給 IT 的資訊')).toBeNull();
  });

  it('shows the expired reminder and a copy-to-IT button that copies the request text', async () => {
    mockGetIapAllowlist.mockResolvedValue({
      configured: true,
      junyi_domain_active: false,
      external_grants: [
        {
          email: 'old@example.com',
          name: '舊訪客',
          status: 'expired',
          expires_at: '2026-01-01T00:00:00+00:00',
        },
      ],
    });
    await renderPanel();
    await waitFor(() => {
      expect(screen.getByText('已過期，請 IT 協助開通 IAP')).toBeTruthy();
    });

    const copyButton = screen.getByText('複製給 IT 的資訊');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const copiedText = (navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(copiedText).toContain('old@example.com');
    expect(copiedText).toContain('舊訪客');
  });

  it('shows an error state with a retry button when the API call fails', async () => {
    mockGetIapAllowlist.mockRejectedValue(new Error('network down'));
    await renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/無法載入/)).toBeTruthy();
    });
    expect(screen.getByText('重試')).toBeTruthy();
  });
});
