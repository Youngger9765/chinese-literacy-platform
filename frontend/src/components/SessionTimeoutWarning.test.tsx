/**
 * Unit tests for SessionTimeoutWarning component (Issue #408)
 * Tests rendering, countdown, and button callbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import SessionTimeoutWarning from './SessionTimeoutWarning';

describe('SessionTimeoutWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when visible is false', () => {
    render(
      <SessionTimeoutWarning
        visible={false}
        countdownSeconds={60}
        onContinue={vi.fn()}
        onExpired={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the modal when visible is true', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={60}
        onContinue={vi.fn()}
        onExpired={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('學習 Session 即將逾時')).toBeTruthy();
  });

  it('shows the initial countdown value', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={30}
        onContinue={vi.fn()}
        onExpired={vi.fn()}
      />,
    );
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('decrements countdown each second', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={5}
        onContinue={vi.fn()}
        onExpired={vi.fn()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('3')).toBeTruthy();
  });

  it('calls onExpired when countdown reaches zero', () => {
    const onExpired = vi.fn();
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={3}
        onContinue={vi.fn()}
        onExpired={onExpired}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('calls onContinue when "繼續學習" button is clicked', () => {
    const onContinue = vi.fn();
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={60}
        onContinue={onContinue}
        onExpired={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('繼續學習'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('calls onExpired when "離開並儲存" button is clicked', () => {
    const onExpired = vi.fn();
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={60}
        onContinue={vi.fn()}
        onExpired={onExpired}
      />,
    );

    fireEvent.click(screen.getByText('離開並儲存'));
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('shows the saved-progress notice', () => {
    render(
      <SessionTimeoutWarning
        visible={true}
        countdownSeconds={60}
        onContinue={vi.fn()}
        onExpired={vi.fn()}
      />,
    );
    expect(screen.getByText(/目前步驟已儲存/)).toBeTruthy();
  });
});
