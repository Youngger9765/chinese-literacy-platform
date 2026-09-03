import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ClassroomJoinQrButton from './ClassroomJoinQrButton';
import { QR_ENTRY_ORIGIN } from './classroomJoinQr';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async (v: string) => `data:image/png;base64,QR(${v})`) },
}));

afterEach(() => { vi.restoreAllMocks(); });

describe('ClassroomJoinQrButton (#3081)', () => {
  it('renders nothing when there is no join code (AC1: nothing to encode)', () => {
    render(<ClassroomJoinQrButton classroomName="五年甲班" joinCode={null} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a popup with a big QR, the classroom name, and the code itself (AC1)', async () => {
    render(<ClassroomJoinQrButton classroomName="五年甲班" joinCode="ABC123" />);

    fireEvent.click(screen.getByRole('button', { name: '顯示加入班級 QR code' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('五年甲班')).toBeTruthy();
    // The code itself, in big text, for students the scan missed.
    expect(screen.getByText('ABC123')).toBeTruthy();
    // A visible QR image, not just a placeholder.
    expect(screen.getByRole('img', { name: /QR code/ })).toBeTruthy();
    // The no-expiry caveat teachers need to see (issue design decision ③).
    expect(screen.getByText(/長期有效/)).toBeTruthy();
  });

  it(
    'encodes /join?code= using QR_ENTRY_ORIGIN, never window.location.origin ' +
    '(regression lock: #3081 AC design decision ②, mirrors the LessonQrButton bug)',
    async () => {
      // Positive control: prove the two origins actually differ in this test
      // environment, or the assertion below would pass even if the component
      // silently switched back to window.location.origin.
      expect(window.location.origin).not.toBe(QR_ENTRY_ORIGIN);

      render(<ClassroomJoinQrButton classroomName="五年甲班" joinCode="XYZ999" />);
      fireEvent.click(screen.getByRole('button', { name: '顯示加入班級 QR code' }));

      const expectedUrl = `${QR_ENTRY_ORIGIN}/join?code=XYZ999`;
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
      expect(screen.getByText(expectedUrl)).toBeTruthy();
      expect(screen.getByRole('img', { name: /QR code/ }).getAttribute('src'))
        .toBe(`data:image/png;base64,QR(${expectedUrl})`);

      // And explicitly not the browser's own origin.
      expect(screen.queryByText(`${window.location.origin}/join?code=XYZ999`)).toBeNull();
    },
  );

  it('closes on Escape (AC1)', async () => {
    render(<ClassroomJoinQrButton classroomName="五年甲班" joinCode="ABC123" />);
    fireEvent.click(screen.getByRole('button', { name: '顯示加入班級 QR code' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // See lessonQr.test.tsx's identical retry for why this resends: there is
    // a one-tick gap between the dialog mounting and its keydown effect
    // actually attaching.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes on clicking outside the card (AC1)', async () => {
    render(<ClassroomJoinQrButton classroomName="五年甲班" joinCode="ABC123" />);
    fireEvent.click(screen.getByRole('button', { name: '顯示加入班級 QR code' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog); // the overlay itself, not the card inside it
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
