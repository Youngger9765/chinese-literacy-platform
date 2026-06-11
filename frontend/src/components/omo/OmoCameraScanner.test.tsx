/**
 * Tests for OmoCameraScanner (#2089 item 4) — in-browser camera scanner.
 * Focuses on the states jsdom can exercise: unsupported browser, permission
 * denied, and the live-state shutter/done controls. Frame capture (canvas
 * toBlob from a live <video>) is not exercisable in jsdom and is covered by
 * manual / staging QA.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OmoCameraScanner from './OmoCameraScanner';

function setMediaDevices(getUserMedia: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: getUserMedia ? { getUserMedia } : undefined,
  });
}

describe('OmoCameraScanner', () => {
  beforeEach(() => {
    // jsdom has no real media playback; stub play().
    (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = vi
      .fn()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setMediaDevices(null);
  });

  it('shows an unsupported message when getUserMedia is unavailable', async () => {
    setMediaDevices(undefined);
    render(
      <OmoCameraScanner onCapture={vi.fn()} onClose={vi.fn()} pageCount={0} canCapture />,
    );
    await waitFor(() =>
      expect(screen.getByText(/不支援網頁內相機/)).toBeInTheDocument(),
    );
  });

  it('shows a permission message when the user denies the camera', async () => {
    const denied = vi.fn().mockRejectedValue(
      Object.assign(new DOMException('denied', 'NotAllowedError')),
    );
    setMediaDevices(denied);
    render(
      <OmoCameraScanner onCapture={vi.fn()} onClose={vi.fn()} pageCount={0} canCapture />,
    );
    await waitFor(() =>
      expect(screen.getByText(/沒有相機權限/)).toBeInTheDocument(),
    );
  });

  it('stops tracks and closes when 返回上傳 is clicked after an error', async () => {
    setMediaDevices(vi.fn().mockRejectedValue(new DOMException('x', 'NotFoundError')));
    const onClose = vi.fn();
    render(
      <OmoCameraScanner onCapture={vi.fn()} onClose={onClose} pageCount={0} canCapture />,
    );
    await waitFor(() => expect(screen.getByText(/找不到可用的相機/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('返回上傳'));
    expect(onClose).toHaveBeenCalled();
  });

  it('goes live and shows the running page count + enabled 完成', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    setMediaDevices(vi.fn().mockResolvedValue(stream));
    render(
      <OmoCameraScanner onCapture={vi.fn()} onClose={vi.fn()} pageCount={2} canCapture />,
    );
    await waitFor(() => expect(screen.getByText('已掃描 2 頁')).toBeInTheDocument());
    // shutter is present and enabled
    expect(screen.getByLabelText('拍攝這一頁')).not.toBeDisabled();
    // 完成 enabled because pageCount > 0
    expect(screen.getByText('完成')).not.toBeDisabled();
  });

  it('disables the shutter when the file cap is reached', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    setMediaDevices(vi.fn().mockResolvedValue(stream));
    render(
      <OmoCameraScanner onCapture={vi.fn()} onClose={vi.fn()} pageCount={5} canCapture={false} />,
    );
    await waitFor(() => expect(screen.getByLabelText('拍攝這一頁')).toBeDisabled());
    expect(screen.getByText(/已達檔案數上限/)).toBeInTheDocument();
  });
});
